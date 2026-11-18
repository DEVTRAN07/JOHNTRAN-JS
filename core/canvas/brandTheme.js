"use strict";

/**
 * Fixed JOHNTRAN identity palette.
 * The /theme command changes photography, not the brand colors.
 */
const BRAND = Object.freeze({
  label: "JOHNTRAN · Aurora Cyber",
  accent: "#62dcff",
  background: ["#030914", "#07182d", "#102b4b", "#040d1d"],
  panel: ["#102b4b", "#08182c"],
  card: ["#122c4b", "#091a31"],
  footer: ["#0c2038", "#071426"],
  border: "rgba(98,220,255,.54)",
  cardBorder: "rgba(98,220,255,.36)",
  glow: ["rgba(33,151,255,.22)", "rgba(118,94,255,.16)"],
  infoFill: "rgba(98,220,255,.12)",
  infoBorder: "rgba(98,220,255,.52)",
  text: "#f4f9ff",
  muted: "#a9bfd8"
});

function getPalette() {
  return {
    ...BRAND,
    background: BRAND.background.slice(),
    panel: BRAND.panel.slice(),
    card: BRAND.card.slice(),
    footer: BRAND.footer.slice(),
    glow: BRAND.glow.slice()
  };
}

function getThemeInfo() {
  return {
    name: "aurora-cyber",
    label: BRAND.label,
    accent: BRAND.accent
  };
}

function signature() {
  return "johntran-aurora-cyber-v1";
}

module.exports = {
  getPalette,
  getThemeInfo,
  signature,
  BRAND
};
