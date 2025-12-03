using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Reflection;
using vatsys;

namespace VscsStreamdeckBridge
{
    internal static class BridgeServer
    {
        private static HttpListener _listener;
        private static Thread _listenThread;
        private static readonly JavaScriptSerializer Serializer = new JavaScriptSerializer { MaxJsonLength = int.MaxValue };
        private const string Prefix = "http://127.0.0.1:18084/";
        private static readonly Lazy<object> AudioInstance = new Lazy<object>(() =>
        {
            var type = typeof(Audio);
            var field = type.GetField("Instance", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
            if (field != null) return field.GetValue(null);
            var prop = type.GetProperty("Instance", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
            return prop?.GetValue(null, null);
        });
        private static readonly Lazy<Type> MumbleType = new Lazy<Type>(() => typeof(Network).Assembly.GetType("vatsys.Mumble"));
        private static readonly Lazy<MethodInfo> MumbleIsConnectedGetter =
            new Lazy<MethodInfo>(() => MumbleType.Value?.GetProperty("IsConnected", BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)?.GetMethod);

        internal static void Start()
        {
            try
            {
                if (_listener != null) return;

                _listener = new HttpListener();
                _listener.Prefixes.Add(Prefix);
                _listener.Start();

                _listenThread = new Thread(ListenLoop) { IsBackground = true, Name = "VscsBridgeHttp" };
                _listenThread.Start();
            }
            catch (Exception ex)
            {
                Errors.Add(ex, Plugin.DisplayName);
            }
        }

        private static void ListenLoop()
        {
            while (_listener != null && _listener.IsListening)
            {
                try
                {
                    var ctx = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(_ => Handle(ctx));
                }
                catch
                {
                    // Listener stopped or broken; bail out silently.
                    return;
                }
            }
        }

        private static void Handle(HttpListenerContext ctx)
        {
            try
            {
                var path = ctx.Request.Url?.AbsolutePath?.TrimEnd('/') ?? "/";
                ctx.Response.AddHeader("Access-Control-Allow-Origin", "*");
                ctx.Response.AddHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
                ctx.Response.AddHeader("Access-Control-Allow-Headers", "Content-Type");

                if (ctx.Request.HttpMethod == "OPTIONS")
                {
                    ctx.Response.StatusCode = 200;
                    ctx.Response.Close();
                    return;
                }

                if (path.Equals("/state", StringComparison.OrdinalIgnoreCase))
                {
                    WriteJson(ctx, BuildState());
                    return;
                }

                if (path.StartsWith("/freq/", StringComparison.OrdinalIgnoreCase))
                {
                    HandleFrequency(ctx, path.Substring("/freq/".Length));
                    return;
                }

                if (path.StartsWith("/line/", StringComparison.OrdinalIgnoreCase))
                {
                    HandleLine(ctx, path.Substring("/line/".Length));
                    return;
                }

                if (path.StartsWith("/toggle/", StringComparison.OrdinalIgnoreCase))
                {
                    HandleToggle(ctx, path.Substring("/toggle/".Length));
                    return;
                }

                ctx.Response.StatusCode = 404;
                ctx.Response.Close();
            }
            catch (Exception ex)
            {
                try
                {
                    ctx.Response.StatusCode = 500;
                    WriteJson(ctx, new { error = ex.Message });
                }
                catch { }
            }
        }

        private static ApiState BuildState()
        {
            var state = new ApiState();
            try
            {
                var freqs = Audio.VSCSFrequencies ?? new List<VSCSFrequency>();
                foreach (var f in freqs)
                {
                    state.frequencies.Add(new ApiFrequency
                    {
                        id = Helpers.ToSafeId(f.Name, f.Frequency),
                        name = string.IsNullOrWhiteSpace(f.FriendlyName) ? f.Name : f.FriendlyName,
                        frequency = f.Frequency,
                        receive = f.Receive,
                        transmit = f.Transmit,
                        friendlyName = f.FriendlyName
                    });
                }

                var lines = Audio.VSCSLines ?? new List<VSCSLine>();
                foreach (var l in lines)
                {
                    var color = GetLineColor(l);
                    var typeName = l.Type.ToString();
                    state.lines.Add(new ApiLine
                    {
                        // Preserve uniqueness per type so hot/cold both show up.
                        id = Helpers.ToSafeId($"{l.Name}_{typeName}"),
                        name = l.Name,
                        type = typeName,
                        state = l.State.ToString(),
                        external = l.External,
                        color = color
                    });
                }

                state.toggles = new ApiToggles
                {
                    group = Audio.GroupFrequencies,
                    allSpeaker = Audio.VSCSAllToSpeaker,
                    tonesSpeaker = Audio.VSCSTonesToSpeaker,
                    mute = Audio.MuteInput,
                    atisReceive = Audio.VSCSATISMonitor != null && Audio.VSCSATISMonitor.Receive
                };

                state.networkValid = Network.ValidATC;
            }
            catch (Exception ex)
            {
                state.error = ex.Message;
            }

            return state;
        }

        private static void HandleFrequency(HttpListenerContext ctx, string tail)
        {
            var parts = tail.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2)
            {
                ctx.Response.StatusCode = 400;
                WriteJson(ctx, new { error = "Missing frequency id or action." });
                return;
            }

            var id = parts[0];
            var action = parts[1].ToLowerInvariant();

            var freq = FindFrequency(id);
            if (freq == null)
            {
                ctx.Response.StatusCode = 404;
                WriteJson(ctx, new { error = "Frequency not found." });
                return;
            }

            if (action == "mode")
            {
                var body = ReadBody(ctx);
                var mode = body?.ToLowerInvariant();
                if (string.IsNullOrWhiteSpace(mode))
                {
                    ctx.Response.StatusCode = 400;
                    WriteJson(ctx, new { error = "Missing mode (off|rx|tx)." });
                    return;
                }

                if (mode == "tx" && !Network.ValidATC)
                {
                    ctx.Response.StatusCode = 403;
                    WriteJson(ctx, new { error = "Cannot transmit when not a valid ATC." });
                    return;
                }

                switch (mode)
                {
                    case "off":
                        freq.Transmit = false;
                        freq.Receive = false;
                        break;
                    case "rx":
                        freq.Transmit = false;
                        freq.Receive = true;
                        break;
                    case "tx":
                        freq.Transmit = true;
                        freq.Receive = true;
                        break;
                    default:
                        ctx.Response.StatusCode = 400;
                        WriteJson(ctx, new { error = "Unknown mode." });
                        return;
                }

                WriteJson(ctx, new { ok = true });
                return;
            }

            if (action == "remove")
            {
                InvokeAudio("RemoveVSCSFrequency", freq, false);
                WriteJson(ctx, new { ok = true });
                return;
            }

            ctx.Response.StatusCode = 400;
            WriteJson(ctx, new { error = "Unknown frequency action." });
        }

        private static void HandleLine(HttpListenerContext ctx, string tail)
        {
            var parts = tail.Split(new[] { '/' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 1)
            {
                ctx.Response.StatusCode = 400;
                WriteJson(ctx, new { error = "Missing line id." });
                return;
            }

            var id = parts[0];
            var line = FindLine(id);
            if (line == null)
            {
                ctx.Response.StatusCode = 404;
                WriteJson(ctx, new { error = "Line not found." });
                return;
            }

            // Toggle: if open/outbound -> close; otherwise try to open/outbound regardless of ATC/mumble flags.
            var state = line.State;
            if (state == VSCSLineStates.Open || state == VSCSLineStates.Outbound)
            {
                InvokeAudio("CloseVSCSLine", line, true, true);
            }
            else if (state == VSCSLineStates.Inbound)
            {
                InvokeAudio("OpenVSCSLine", line, true);
            }
            else
            {
                // Closed/Unknown: attempt outbound/open.
                InvokeAudio("OutboundVSCSLine", line);
            }

            WriteJson(ctx, new { ok = true });
        }

        private static void HandleToggle(HttpListenerContext ctx, string tail)
        {
            var key = tail.ToLowerInvariant();
            switch (key)
            {
                case "group":
                    if (Network.Me != null && Network.Me.IsRealATC)
                    {
                        Audio.GroupFrequencies = !Audio.GroupFrequencies;
                    }
                    break;
                case "allspeaker":
                    Audio.VSCSAllToSpeaker = !Audio.VSCSAllToSpeaker;
                    break;
                case "tonesspeaker":
                    Audio.VSCSTonesToSpeaker = !Audio.VSCSTonesToSpeaker;
                    break;
                case "mute":
                    Audio.MuteInput = !Audio.MuteInput;
                    break;
                case "atis":
                    if (Audio.VSCSATISMonitor != null)
                    {
                        Audio.VSCSATISMonitor.Receive = !Audio.VSCSATISMonitor.Receive;
                    }
                    break;
                default:
                    ctx.Response.StatusCode = 400;
                    WriteJson(ctx, new { error = "Unknown toggle." });
                    return;
            }

            WriteJson(ctx, new { ok = true });
        }

        private static VSCSFrequency FindFrequency(string id)
        {
            try
            {
                var freqs = Audio.VSCSFrequencies ?? new List<VSCSFrequency>();
                foreach (var f in freqs)
                {
                    if (Helpers.EqualsId(id, f.Name, f.Frequency)) return f;
                    if (Helpers.EqualsId(id, f.FriendlyName ?? string.Empty, f.Frequency)) return f;
                }
            }
            catch { }

            return null;
        }

        private static VSCSLine FindLine(string id)
        {
            try
            {
                var lines = Audio.VSCSLines ?? new List<VSCSLine>();
                return lines.FirstOrDefault(l =>
                {
                    var typeName = l.Type.ToString();
                    return Helpers.EqualsId(id, l.Name)
                           || Helpers.EqualsId(id, $"{l.Name}_{typeName}")
                           || Helpers.EqualsId(id, $"{l.Name}-{typeName}");
                });
            }
            catch
            {
                return null;
            }
        }

        private static bool InvokeAudio(string methodName, params object[] args)
        {
            try
            {
                var instance = AudioInstance.Value;
                if (instance == null) return false;
                var method = instance.GetType().GetMethod(methodName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                if (method == null) return false;
                method.Invoke(instance, args);
                return true;
            }
            catch
            {
                return false;
            }
        }

        private static bool IsMumbleConnected()
        {
            try
            {
                var getter = MumbleIsConnectedGetter.Value;
                if (getter == null) return true; // do not block if reflection fails
                return (bool)getter.Invoke(null, null);
            }
            catch
            {
                return true;
            }
        }

        private static string GetLineColor(VSCSLine line)
        {
            // Simple mapping to give the Stream Deck a hint for UI coloring.
            switch (line.Type)
            {
                case VSCSLineTypes.Hotline:
                    return "#b83c3c";
                case VSCSLineTypes.Coldline:
                    return "#4a8ad8";
                case VSCSLineTypes.MonitorIn:
                case VSCSLineTypes.MonitorOut:
                    return "#4ca66a";
                default:
                    return "#777777";
            }
        }

        private static string ReadBody(HttpListenerContext ctx)
        {
            try
            {
                using (var reader = new System.IO.StreamReader(ctx.Request.InputStream, ctx.Request.ContentEncoding))
                {
                    return reader.ReadToEnd();
                }
            }
            catch
            {
                return null;
            }
        }

        private static void WriteJson(HttpListenerContext ctx, object payload)
        {
            var json = Serializer.Serialize(payload);
            var bytes = Encoding.UTF8.GetBytes(json);
            ctx.Response.ContentType = "application/json";
            ctx.Response.ContentEncoding = Encoding.UTF8;
            ctx.Response.ContentLength64 = bytes.Length;
            ctx.Response.OutputStream.Write(bytes, 0, bytes.Length);
            ctx.Response.OutputStream.Flush();
            ctx.Response.Close();
        }
    }
}
