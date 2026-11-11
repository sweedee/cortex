import Borders from '@dynatrace/strato-design-tokens/borders';
import Colors from '@dynatrace/strato-design-tokens/colors';
import Typography from '@dynatrace/strato-design-tokens/typography';

/** Class-based styles for the build page, built from Strato tokens (theme aware). */
export const pipelineCss = `
.ctx-pl { height: 100%; display: flex; flex-direction: column; min-height: 0; box-sizing: border-box; padding: 16px 24px 16px; gap: 14px; }
.ctx-pl *, .ctx-pl *::before, .ctx-pl *::after { box-sizing: border-box; }
.ctx-pl__head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex: none; }
.ctx-pl__facts { display: flex; flex-wrap: wrap; gap: 4px 20px; color: ${Colors.Text.Neutral.Subdued};
  font-family: ${Typography.Text.Small.Default.Family}; font-size: ${Typography.Text.Small.Default.Size}; }
.ctx-pl__facts b { font-weight: 500; color: ${Colors.Text.Neutral.Default}; }
.ctx-pl__mono { font-family: ${Typography.Code.Small.Default.Family}; font-size: ${Typography.Code.Small.Default.Size}; }
.ctx-pl__flow { display: flex; align-items: stretch; flex: none; overflow-x: auto; padding: 2px 2px 6px; }
.ctx-pl__step { all: unset; box-sizing: border-box; cursor: pointer; flex: 1 1 0; min-width: 118px; display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px; border: 1px solid ${Colors.Border.Neutral.Default}; border-radius: ${Borders.Radius.Container.Default};
  background: ${Colors.Background.Surface.Default}; position: relative; }
.ctx-pl__step:hover { background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-pl__step:focus-visible { outline: 2px solid ${Colors.Border.Primary.Accent}; outline-offset: 1px; }
.ctx-pl__step[aria-pressed='true'] { border-color: ${Colors.Border.Primary.Accent}; box-shadow: 0 0 0 1px ${Colors.Border.Primary.Accent}; }
.ctx-pl__step[data-status='queued'], .ctx-pl__step[data-status='skipped'] { color: ${Colors.Text.Neutral.Subdued}; }
.ctx-pl__step[data-status='failed'] { background: ${Colors.Background.Container.Critical.Default}; }
.ctx-pl__step-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
.ctx-pl__step-name { font-size: ${Typography.Text.Base.Default.Size}; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ctx-pl__step-sub { font-size: ${Typography.Text.Small.Default.Size};
  color: ${Colors.Text.Neutral.Subdued}; font-variant-numeric: tabular-nums; padding-left: 24px; }
.ctx-pl__conn { flex: none; width: 20px; align-self: center; height: 2px; background: ${Colors.Border.Neutral.Default}; }
.ctx-pl__conn[data-done='true'] { background: ${Colors.Icon.Success.Default}; }
.ctx-pl__pulse { animation: ctx-pl-pulse 1.2s ease-in-out infinite; }
@keyframes ctx-pl-pulse { 50% { opacity: 0.3; } }
.ctx-pl__detail { flex: 1; min-height: 0; display: flex; flex-direction: column; border: 1px solid ${Colors.Border.Neutral.Default};
  border-radius: ${Borders.Radius.Container.Default}; overflow: hidden; background: ${Colors.Background.Surface.Default}; }
.ctx-pl__detail-head { display: flex; align-items: center; gap: 12px; padding: 8px 12px; flex: none; flex-wrap: wrap;
  border-bottom: 1px solid ${Colors.Border.Neutral.Default}; background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-pl__tests { display: flex; gap: 10px; margin-left: auto; font-size: ${Typography.Text.Small.Default.Size}; font-variant-numeric: tabular-nums; }
.ctx-pl__log { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 8px 0;
  font-family: ${Typography.Code.Base.Default.Family}; font-size: 12px; line-height: 18px; color: ${Colors.Text.Neutral.Default}; }
.ctx-pl__line { display: grid; grid-template-columns: 52px minmax(0, 1fr); padding-right: 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
.ctx-pl__line:hover { background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-pl__no { text-align: right; padding-right: 14px; color: ${Colors.Text.Neutral.Subdued}; opacity: 0.7; user-select: none; font-variant-numeric: tabular-nums; }
.ctx-pl__line[data-err='true'] { background: ${Colors.Background.Container.Critical.Default}; color: ${Colors.Text.Critical.Default}; }
.ctx-pl__line[data-warn='true'] { color: ${Colors.Text.Warning.Default}; }
.ctx-pl__empty { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; text-align: center; padding: 24px; color: ${Colors.Text.Neutral.Subdued}; }
.ctx-pl__hist { display: flex; align-items: center; gap: 6px; flex: none; overflow-x: auto; }
.ctx-pl__hist-item { display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: ${Borders.Radius.Field.Default};
  border: 1px solid ${Colors.Border.Neutral.Default}; font-size: ${Typography.Text.Small.Default.Size}; white-space: nowrap; font-variant-numeric: tabular-nums; }
.ctx-pl__live { display: inline-flex; align-items: center; gap: 6px; color: ${Colors.Text.Primary.Default}; font-size: ${Typography.Text.Small.Default.Size}; }
.ctx-pl__live::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: ctx-pl-pulse 1.2s ease-in-out infinite; }
`;
