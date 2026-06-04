// Analyst: NasoSan | Dev: Claude AI
// Licenza: CC BY 4.0 – nasosan.it | https://creativecommons.org/licenses/by/4.0/

const colors = {
  light: {
    background: "#1e1e26",
    panels: "#2a2a36",
    dark: "#16161e",
    separators: "#3a3a4a",
    text: "#c8c8d2",
    borderInput: "#4a4a5a",
    playGreen: "#149650",
    playBorder: "#1db060",
    accent: "#64c8ff",
    notes: "#8cc8ff",
    warning: "#ffb432",
    ok: "#64c864",
    error: "#e05555",
    errorBg: "#2a1616",
    normOffBorder: "#962828",
    normActiveBg: "#102010",
    normAnalyzingBg: "#2a2010",
    rowActive: "#252530",
    timeTotal: "#7a98b8",
    labelDim: "#4a6a8a",
    cassetteBody: "#2d2d2d",
    cassetteLabelTop: "#f0f0e8",
    cassetteLabelDefault: "#c8200a",
    tapeColor: "#1a1200", // distinto da TAPE_COLOR in CassetteSVG.tsx — divergenza voluta per design
    frame: "#444444",
    reelWindow: "#0a0a0a",
  },
  radius: 6,
};

export const C = colors.light;
export default colors;
