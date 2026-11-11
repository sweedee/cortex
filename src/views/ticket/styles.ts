import Borders from '@dynatrace/strato-design-tokens/borders';
import Colors from '@dynatrace/strato-design-tokens/colors';
import Typography from '@dynatrace/strato-design-tokens/typography';

/**
 * Class-based styles for the ticket page. Built from Strato design tokens so
 * the page follows the active theme; injected once via <style>.
 */
export const ticketCss = `
.ctx-ticket {
  height: 100%;
  overflow: auto;
  container-type: inline-size;
  box-sizing: border-box;
}
.ctx-ticket *, .ctx-ticket *::before, .ctx-ticket *::after { box-sizing: border-box; }
.ctx-ticket__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 272px;
  gap: 32px;
  max-width: 1240px;
  margin: 0 auto;
  padding: 20px 24px 48px;
  align-items: start;
}
.ctx-ticket__grid--single { grid-template-columns: minmax(0, 1fr); max-width: 920px; }
.ctx-ticket__aside { position: sticky; top: 20px; }
@container (max-width: 780px) {
  .ctx-ticket__grid { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .ctx-ticket__aside { position: static; order: -1; }
  .ctx-ticket__fields { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }
}
.ctx-ticket__section + .ctx-ticket__section {
  margin-top: 28px;
}
.ctx-ticket__section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  min-height: 24px;
}
.ctx-ticket__count {
  color: ${Colors.Text.Neutral.Subdued};
  font-family: ${Typography.Text.Small.Default.Family};
  font-size: ${Typography.Text.Small.Default.Size};
  font-variant-numeric: tabular-nums;
}
.ctx-ticket__strip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 8px 8px 12px;
  border-radius: ${Borders.Radius.Container.Default};
  background: ${Colors.Background.Container.Primary.Default};
  margin-bottom: 20px;
  min-height: 44px;
}
.ctx-ticket__strip--neutral { background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-ticket__card {
  border: 1px solid ${Colors.Border.Neutral.Default};
  border-radius: ${Borders.Radius.Container.Default};
  background: ${Colors.Background.Surface.Default};
}
.ctx-ticket__ac { padding: 4px 12px; }
.ctx-ticket__ac-row { padding: 6px 0; }
.ctx-ticket__ac-row + .ctx-ticket__ac-row { border-top: 1px solid ${Colors.Border.Neutral.Subdued}; }
.ctx-ticket__link-row {
  display: grid;
  grid-template-columns: 104px 84px minmax(0, 1fr);
  gap: 8px;
  align-items: baseline;
  padding: 7px 12px;
}
.ctx-ticket__link-row + .ctx-ticket__link-row { border-top: 1px solid ${Colors.Border.Neutral.Subdued}; }
.ctx-ticket__key {
  font-family: ${Typography.Code.Small.Default.Family};
  font-size: ${Typography.Code.Small.Default.Size};
  color: ${Colors.Text.Neutral.Subdued};
  white-space: nowrap;
}
button.ctx-ticket__key {
  all: unset;
  cursor: pointer;
  font-family: ${Typography.Code.Small.Default.Family};
  font-size: ${Typography.Code.Small.Default.Size};
  color: ${Colors.Text.Primary.Default};
  white-space: nowrap;
}
button.ctx-ticket__key:hover { text-decoration: underline; color: ${Colors.Text.Primary.DefaultHover}; }
button.ctx-ticket__key:focus-visible { outline: 2px solid ${Colors.Border.Primary.Accent}; outline-offset: 2px; border-radius: 2px; }
.ctx-ticket__comment { display: grid; grid-template-columns: 32px minmax(0, 1fr); gap: 12px; }
.ctx-ticket__comment + .ctx-ticket__comment { margin-top: 18px; }
.ctx-ticket__comment-body {
  margin-top: 2px;
  overflow-wrap: anywhere;
}
.ctx-ticket__md { overflow-wrap: anywhere; min-width: 0; }
.ctx-ticket__md > div > :first-child, .ctx-ticket__md > :first-child { margin-top: 0; }
.ctx-ticket__md h1, .ctx-ticket__md h2, .ctx-ticket__md h3 { font-size: 16px; line-height: 24px; margin: 20px 0 6px; }
.ctx-ticket__md h4, .ctx-ticket__md h5 { font-size: 14px; line-height: 20px; margin: 16px 0 4px; }
.ctx-ticket__md table { display: block; max-width: 100%; overflow-x: auto; }
.ctx-ticket__md pre { max-width: 100%; overflow-x: auto; }
.ctx-ticket__field {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-height: 32px;
  padding: 2px 0;
}
.ctx-ticket__field-label {
  color: ${Colors.Text.Neutral.Subdued};
  font-family: ${Typography.Text.Small.Default.Family};
  font-size: ${Typography.Text.Small.Default.Size};
  line-height: ${Typography.Text.Small.Default.LineHeight};
}
.ctx-ticket__field-value {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  min-width: 0;
  color: ${Colors.Text.Neutral.Default};
  font-family: ${Typography.Text.Base.Default.Family};
  font-size: ${Typography.Text.Base.Default.Size};
  line-height: ${Typography.Text.Base.Default.LineHeight};
}
.ctx-ticket__divider { height: 1px; background: ${Colors.Border.Neutral.Default}; margin: 12px 0; }
.ctx-ticket__dev-row {
  all: unset;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  margin: 0 -8px;
  border-radius: ${Borders.Radius.Field.Default};
  cursor: pointer;
  color: ${Colors.Text.Neutral.Default};
  font-family: ${Typography.Text.Small.Default.Family};
  font-size: ${Typography.Text.Small.Default.Size};
  line-height: ${Typography.Text.Small.Default.LineHeight};
}
.ctx-ticket__dev-row:hover { background: ${Colors.Background.Container.Neutral.Default}; }
.ctx-ticket__dev-row:focus-visible { outline: 2px solid ${Colors.Border.Primary.Accent}; }
.ctx-ticket__ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
`;
