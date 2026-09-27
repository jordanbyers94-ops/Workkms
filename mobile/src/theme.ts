import { useColorScheme } from "react-native";

const light = {
  bg: "#EDF0F3", surface: "#FFFFFF", ink: "#18222D", muted: "#5B6773", line: "#D3D9DF",
  field: "#F6F8FA", hivis: "#F4C21B", hivisInk: "#1A1810", danger: "#B3261E", ok: "#2E9E5B",
};
const dark: typeof light = {
  bg: "#11171E", surface: "#1A222B", ink: "#E8ECF0", muted: "#98A4AF", line: "#2B3642",
  field: "#141B22", hivis: "#F4C21B", hivisInk: "#1A1810", danger: "#F2867E", ok: "#4CC27E",
};
export type Colors = typeof light;
export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}
