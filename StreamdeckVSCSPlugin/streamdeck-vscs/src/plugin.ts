import streamDeck, { LogLevel } from "@elgato/streamdeck";

import { VscsLineAction } from "./actions/line";
import { VscsToggleAction } from "./actions/toggle";

// We can enable "trace" logging so that all messages between the Stream Deck, and the plugin are recorded. When storing sensitive information
streamDeck.logger.setLevel(LogLevel.TRACE);

// Register VSCS actions.
streamDeck.actions.registerAction(new VscsLineAction());
streamDeck.actions.registerAction(new VscsToggleAction());

// Finally, connect to the Stream Deck.
streamDeck.connect();
