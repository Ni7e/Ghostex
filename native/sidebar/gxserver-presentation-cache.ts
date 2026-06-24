/*
CDXC:GxserverPresentationParity 2026-06-24-10:45:
The reducer implementation moved to shared/ so GPUI and macOS apply gxserver presentation deltas identically. Keep this native module as a compatibility export for existing macOS imports while new clients import the shared reducer directly.
*/
export * from "../../shared/gxserver-presentation-cache";
