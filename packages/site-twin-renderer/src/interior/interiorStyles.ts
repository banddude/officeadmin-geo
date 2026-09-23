/*
 * interiorStyles.ts -- the overlay's stylesheet, injected by InteriorOverlay so
 * the renderer package needs no CSS build step. Class colours come from
 * palette.ts so the legend swatch and the drawn element can never disagree.
 */
import { PALETTE } from "./palette";

export const INTERIOR_CSS = `
.oabm-overlay { position: absolute; inset: 0; pointer-events: none; z-index: 6; font-family: "Manrope", system-ui, sans-serif; color: #1f2b28; }
.oabm-overlay * { box-sizing: border-box; }
.oabm-panel { pointer-events: auto; position: absolute; top: 68px; bottom: 40px; overflow-y: auto; background: rgba(247, 247, 241, 0.95);
  border: 1px solid rgba(31, 41, 38, 0.14); border-radius: 14px; box-shadow: 0 18px 50px rgba(28, 42, 37, 0.16); backdrop-filter: blur(14px); }
.oabm-left { left: 14px; width: 312px; padding: 12px 13px 16px; }
.oabm-right { right: 14px; width: 352px; padding: 14px 15px 18px; }
.oabm-panel h2 { margin: 0; font-size: 15px; letter-spacing: -0.01em; }
.oabm-panel h3 { margin: 6px 0 2px; font-size: 16px; letter-spacing: -0.015em; }
.oabm-panel h4 { margin: 12px 0 6px; font: 600 9.5px/1.2 "DM Mono", ui-monospace, monospace; letter-spacing: 0.08em; text-transform: uppercase; color: #52625c; }
.oabm-section { border-top: 1px solid rgba(31, 41, 38, 0.1); padding-top: 8px; margin-top: 9px; }
.oabm-eyebrow { font: 500 8.5px/1.2 "DM Mono", ui-monospace, monospace; letter-spacing: 0.13em; color: #6b7b74; margin: 0; text-transform: uppercase; }
.oabm-muted { color: #66756f; font-size: 11px; line-height: 1.4; margin: 3px 0 0; }
.oabm-tiny { font-size: 10px; }
.oabm-seg { display: flex; gap: 4px; margin: 8px 0 2px; padding: 3px; background: rgba(31, 41, 38, 0.07); border-radius: 999px; }
.oabm-seg button { flex: 1; border: 0; background: transparent; border-radius: 999px; padding: 6px 4px; font: 600 11px/1 "Manrope", sans-serif; color: #33443f; cursor: pointer; }
.oabm-seg button.on { background: #23332f; color: #f5f2e8; }
.oabm-legend-row { display: grid; grid-template-columns: 26px 1fr auto; gap: 7px; align-items: start; padding: 4px 0; }
.oabm-legend-row b { font-size: 11.5px; }
.oabm-legend-row p { grid-column: 2 / 4; margin: 0; font-size: 10px; color: #66756f; line-height: 1.35; }
.oabm-count { font: 500 10px/1.4 "DM Mono", monospace; color: #4b5a55; }
.oabm-sw { display: inline-block; width: 24px; height: 13px; border-radius: 3px; margin-top: 2px; }
.oabm-sw-observed { background: ${PALETTE.observed.fill}; border: 2px solid ${PALETTE.observed.edge}; }
.oabm-sw-user { background: ${PALETTE.user.fill}; border: 2px solid ${PALETTE.user.edge}; }
.oabm-sw-inferred { background: transparent; border: 2px dashed ${PALETTE.inferred.line}; }
.oabm-pill { display: inline-block; padding: 3px 8px; border-radius: 999px; font: 600 10px/1.2 "Manrope", sans-serif; }
.oabm-pill-observed { background: ${PALETTE.observed.fill}; color: #fff; }
.oabm-pill-user { background: ${PALETTE.user.fill}; color: #fff; }
.oabm-pill-inferred { background: #fff; color: ${PALETTE.inferred.edge}; border: 1.5px dashed ${PALETTE.inferred.line}; }
.oabm-list button, .oabm-rowbtn { display: flex; width: 100%; align-items: center; gap: 7px; border: 0; background: transparent; text-align: left; padding: 4px 5px; border-radius: 7px; font: 500 11px/1.25 "Manrope", sans-serif; color: #23312d; cursor: pointer; }
.oabm-list button:hover, .oabm-rowbtn:hover { background: rgba(31, 41, 38, 0.07); }
.oabm-list button.on { background: rgba(35, 51, 47, 0.12); font-weight: 700; }
.oabm-list .grow { flex: 1; }
.oabm-cat { display: grid; grid-template-columns: 1fr auto auto; gap: 4px; align-items: center; font-size: 11px; padding: 2px 0; }
.oabm-cat.off { color: #9aa5a1; text-decoration: line-through; }
.oabm-chip { border: 1px solid rgba(31, 41, 38, 0.18); background: #fbfaf4; border-radius: 999px; padding: 2px 7px; font: 600 9.5px/1.2 "Manrope", sans-serif; cursor: pointer; color: #33443f; }
.oabm-chip.on { background: #23332f; color: #f5f2e8; border-color: #23332f; }
.oabm-input { width: 100%; border: 1px solid rgba(31, 41, 38, 0.2); border-radius: 8px; padding: 6px 8px; font: 500 11.5px "Manrope", sans-serif; background: #fff; }
.oabm-select { width: 100%; border: 1px solid rgba(31, 41, 38, 0.2); border-radius: 8px; padding: 5px 6px; font: 500 11px "Manrope", sans-serif; background: #fff; }
.oabm-range { width: 100%; }
.oabm-kv { display: grid; grid-template-columns: 118px 1fr; gap: 3px 8px; margin: 8px 0 0; font-size: 11.5px; }
.oabm-kv dt { color: #66756f; }
.oabm-kv dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.oabm-kv dd.drawn { color: ${PALETTE.inferred.edge}; }
.oabm-drawnbadge { display: inline-block; margin-left: 6px; padding: 1px 6px; border: 1.5px dashed ${PALETTE.inferred.line}; border-radius: 999px; font: 600 9px/1.3 "Manrope", sans-serif; color: ${PALETTE.inferred.edge}; }
.oabm-drawnwhy { margin: 8px 0 0; padding: 8px 9px; border-left: 3px dashed ${PALETTE.inferred.line}; background: rgba(168, 71, 201, 0.07); font-size: 11px; line-height: 1.45; }
.oabm-records { display: grid; grid-template-columns: repeat(auto-fit, minmax(146px, 1fr)); gap: 7px; }
.oabm-record { border: 1px solid rgba(31, 41, 38, 0.14); border-radius: 9px; padding: 7px 8px; background: #fff; font-size: 10.5px; line-height: 1.4; }
.oabm-record .src { display: block; margin-top: 5px; font: 500 9px/1.3 "DM Mono", monospace; color: #6c7a75; overflow-wrap: anywhere; }
.oabm-note { margin: 8px 0 0; padding: 7px 9px; background: rgba(31, 41, 38, 0.06); border-radius: 8px; font-size: 11px; line-height: 1.45; }
.oabm-btnrow { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
.oabm-btn { border: 1px solid rgba(31, 41, 38, 0.2); background: #fff; border-radius: 8px; padding: 5px 9px; font: 600 10.5px "Manrope", sans-serif; cursor: pointer; color: #23312d; }
.oabm-btn:hover { background: #f0efe7; }
.oabm-details { margin-top: 12px; font-size: 10.5px; }
.oabm-details summary { cursor: pointer; font-weight: 700; color: #4b5a55; }
.oabm-details code, .oabm-mono { font: 500 9.5px/1.4 "DM Mono", monospace; overflow-wrap: anywhere; }
.oabm-banner { pointer-events: auto; position: absolute; top: 16px; left: 50%; transform: translateX(-50%); max-width: min(620px, calc(100vw - 460px)); padding: 7px 14px;
  border-radius: 10px; font: 700 11px/1.35 "Manrope", sans-serif; text-align: center; z-index: 9; }
.oabm-banner-synthetic { background: repeating-linear-gradient(-45deg, #f6d23b 0 14px, #f1c40f 14px 28px); color: #1d1a0a; border: 2px solid #1d1a0a; }
.oabm-banner-bad { top: 58px; background: #b3261e; color: #fff; border: 2px solid #5e0f0a; }
.oabm-footer { pointer-events: auto; position: absolute; left: 0; right: 0; bottom: 0; min-height: 30px; padding: 7px 14px; background: rgba(21, 30, 28, 0.86); color: #dfe7e3;
  font: 500 10px/1.45 "DM Mono", ui-monospace, monospace; display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: center; z-index: 9; }
.oabm-footer b { color: #fff; }
.oabm-footer .bad { color: #ff9b93; font-weight: 700; }
.oabm-summary { pointer-events: none; position: absolute; left: 340px; bottom: 40px; padding: 5px 9px; border-radius: 8px; background: rgba(247, 247, 241, 0.88); font-size: 10.5px; color: #33443f; }
.oabm-scale { pointer-events: none; position: absolute; right: 380px; bottom: 44px; display: flex; align-items: flex-end; gap: 12px; }
.oabm-scalebar { background: rgba(247, 247, 241, 0.9); border-radius: 8px; padding: 5px 8px; font: 600 10px "DM Mono", monospace; }
.oabm-scalebar i { display: block; height: 6px; border: 2px solid #1f2b28; border-top: 0; margin-top: 3px; }
.oabm-compass { width: 46px; height: 46px; border-radius: 50%; background: rgba(247, 247, 241, 0.92); border: 1px solid rgba(31, 41, 38, 0.18); display: grid; place-items: center; }
.oabm-label { display: inline-block; padding: 2px 6px; border-radius: 6px; font: 600 10px/1.2 "Manrope", sans-serif; }
.oabm-label-room { background: rgba(255, 255, 255, 0.86); color: #1f2b28; border: 1px solid rgba(31, 41, 38, 0.18); }
.oabm-label-dim { background: #1f2b28; color: #f7f3e8; font-family: "DM Mono", monospace; font-weight: 500; font-size: 9.5px; }
.oabm-label-reg { background: rgba(255, 255, 255, 0.9); color: ${PALETTE.user.edge}; border: 1px solid ${PALETTE.user.fill}; font-size: 9.5px; }
.oabm-label-site { background: rgba(255, 255, 255, 0.9); color: #2f3634; border: 1px dashed #2f3634; font-size: 9.5px; }
.oabm-warn { margin: 6px 0 0; padding: 7px 9px; border-left: 3px solid #c96e43; background: rgba(201, 110, 67, 0.09); font-size: 11px; line-height: 1.45; }
@media (max-width: 900px) {
  .oabm-left { top: auto; bottom: 36px; left: 8px; right: 8px; width: auto; max-height: 40vh; }
  .oabm-right { top: 60px; left: 8px; right: 8px; width: auto; max-height: 38vh; bottom: auto; }
  .oabm-banner { max-width: calc(100vw - 20px); top: 60px; }
  .oabm-summary, .oabm-scale { display: none; }
}
`;
