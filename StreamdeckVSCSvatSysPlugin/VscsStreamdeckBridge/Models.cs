using System;
using System.Collections.Generic;

namespace VscsStreamdeckBridge
{
    internal class ApiState
    {
        public List<ApiFrequency> frequencies { get; set; } = new List<ApiFrequency>();
        public List<ApiLine> lines { get; set; } = new List<ApiLine>();
        public ApiToggles toggles { get; set; } = new ApiToggles();
        public bool networkValid { get; set; }
        public string error { get; set; }
    }

    internal class ApiFrequency
    {
        public string id { get; set; }
        public string name { get; set; }
        public uint frequency { get; set; }
        public bool receive { get; set; }
        public bool transmit { get; set; }
        public string friendlyName { get; set; }
    }

    internal class ApiLine
    {
        public string id { get; set; }
        public string name { get; set; }
        public string type { get; set; }
        public string state { get; set; }
        public bool external { get; set; }
        public string color { get; set; }
    }

    internal class ApiToggles
    {
        public bool group { get; set; }
        public bool allSpeaker { get; set; }
        public bool tonesSpeaker { get; set; }
        public bool mute { get; set; }
        public bool atisReceive { get; set; }
    }

    internal static class Helpers
    {
        public static string ToSafeId(string name, uint frequency)
        {
            return $"{frequency}:{name}".Replace(" ", "_");
        }

        public static string ToSafeId(string name)
        {
            return name.Replace(" ", "_");
        }

        public static bool EqualsId(string id, string name, uint frequency)
        {
            if (string.Equals(id, frequency.ToString(), StringComparison.OrdinalIgnoreCase)) return true;
            return string.Equals(id, ToSafeId(name, frequency), StringComparison.OrdinalIgnoreCase);
        }

        public static bool EqualsId(string id, string name)
        {
            return string.Equals(id, name, StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(id, ToSafeId(name), StringComparison.OrdinalIgnoreCase);
        }
    }
}
