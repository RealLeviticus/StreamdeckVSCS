using System;
using System.ComponentModel.Composition;
using vatsys.Plugin;
using vatsys;

namespace VscsStreamdeckBridge
{
    [Export(typeof(IPlugin))]
    public class Plugin : IPlugin
    {
        public string Name => DisplayName;
        public static string DisplayName => "VSCS Stream Deck Bridge";

        public Plugin()
        {
            try
            {
                BridgeServer.Start();
            }
            catch (Exception ex)
            {
                Errors.Add(ex, DisplayName);
            }
        }

        public void OnFDRUpdate(FDP2.FDR updated)
        {
            // Not used.
        }

        public async void OnRadarTrackUpdate(RDP.RadarTrack updated)
        {
            await System.Threading.Tasks.Task.CompletedTask;
        }
    }
}
