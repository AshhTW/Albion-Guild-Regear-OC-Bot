export function formatSilver(value) {
  return new Intl.NumberFormat("en-US").format(Math.round(value));
}

export function toTitle(input) {
  if (!input) {
    return "Unknown";
  }
  return input
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}