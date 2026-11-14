import { StrokeIcon } from '../icons';

/** A ticket stub (notched sides, perforation): Strato has no ticket icon (its tag icon is the generic label). */
export function TicketIcon({ size }: { size?: number | 'small' | 'large' }) {
  return (
    <StrokeIcon size={size}>
      <path d="M2 4.6c0-.6.4-1 1-1h10c.6 0 1 .4 1 1v1.5a1.9 1.9 0 0 0 0 3.8v1.5c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1V9.9a1.9 1.9 0 0 0 0-3.8Z" />
      <path d="M10 5v.8M10 7.6v.8M10 10.2V11" />
    </StrokeIcon>
  );
}
