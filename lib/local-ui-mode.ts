export function localUiMode() {
  return process.env.NODE_ENV === "development" && process.env.LOCAL_UI_MODE === "true"
}
