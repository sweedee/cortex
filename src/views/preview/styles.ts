import Borders from '@dynatrace/strato-design-tokens/borders';
import Colors from '@dynatrace/strato-design-tokens/colors';
import Typography from '@dynatrace/strato-design-tokens/typography';

/** Class-based styles for the app preview, built from Strato tokens (theme aware). */
export const previewCss = `
.ctx-pv { height: 100%; display: flex; flex-direction: column; min-height: 0; box-sizing: border-box; padding: 12px 16px 16px; gap: 10px; }
.ctx-pv *, .ctx-pv *::before, .ctx-pv *::after { box-sizing: border-box; }
.ctx-pv__bar { display: flex; align-items: center; gap: 8px; flex: none; flex-wrap: wrap; }
.ctx-pv__addr { flex: 1 1 220px; min-width: 160px; height: 32px; display: flex; align-items: center; padding: 0 12px;
  border: 1px solid ${Colors.Border.Neutral.Default}; border-radius: ${Borders.Radius.Field.Default};
  background: ${Colors.Background.Field.Neutral.Default}; color: ${Colors.Text.Neutral.Default};
  font-family: ${Typography.Code.Small.Default.Family}; font-size: ${Typography.Code.Small.Default.Size}; user-select: all; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.ctx-pv__seg { display: inline-flex; gap: 2px; padding: 2px; border-radius: ${Borders.Radius.Field.Default}; background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-pv__stage { flex: 1; min-height: 0; display: flex; flex-direction: column; border: 1px solid ${Colors.Border.Neutral.Default};
  border-radius: ${Borders.Radius.Container.Default}; overflow: hidden; background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-pv__canvas { flex: 1; min-height: 0; display: flex; justify-content: center; overflow: auto; }
.ctx-pv__frame { height: 100%; border: 0; background: #fff; max-width: 100%; transition: width 0.2s ease; }
.ctx-pv__frame[data-narrow='true'] { border-left: 1px solid ${Colors.Border.Neutral.Default}; border-right: 1px solid ${Colors.Border.Neutral.Default}; }
.ctx-pv__drawer { flex: none; border-top: 1px solid ${Colors.Border.Neutral.Default}; background: ${Colors.Background.Surface.Default}; }
.ctx-pv__drawer-head { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: 6px; width: 100%; padding: 6px 12px; cursor: pointer;
  font-size: ${Typography.Text.Small.Default.Size}; color: ${Colors.Text.Neutral.Default}; }
.ctx-pv__drawer-head:hover { background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-pv__drawer-head:focus-visible { outline: 2px solid ${Colors.Border.Primary.Accent}; outline-offset: -2px; }
.ctx-pv__log { margin: 0; height: 160px; overflow: auto; padding: 6px 12px 8px; border-top: 1px solid ${Colors.Border.Neutral.Subdued};
  font-family: ${Typography.Code.Base.Default.Family}; font-size: 12px; line-height: 18px; color: ${Colors.Text.Neutral.Default}; white-space: pre-wrap; }
.ctx-pv__empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; text-align: center; padding: 24px; color: ${Colors.Text.Neutral.Subdued}; }
.ctx-pv__term { width: min(560px, 100%); text-align: left; border: 1px solid ${Colors.Border.Neutral.Default}; border-radius: ${Borders.Radius.Container.Default};
  background: ${Colors.Background.Surface.Default}; padding: 10px 12px; font-family: ${Typography.Code.Base.Default.Family}; font-size: 12px; line-height: 18px;
  color: ${Colors.Text.Neutral.Default}; white-space: pre-wrap; min-height: 100px; }
`;
