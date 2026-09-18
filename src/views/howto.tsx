// The thirteen-second clip that shows the whole job: tell your agent to add a slopscore file per
// slopscore.org, and it commits one file. Shown wherever the site gives the instructions in words, so a
// reader who skims sees the same thing the reader who reads does.
//
// A muted looping video, not the gif: the mp4 is a tenth of the gif's size at the same frame. The gif is
// the fallback for anything that will not play video, and the poster is the frame with the file on it.

export const HOWTO_ALT = "Tell your agent: add a slopscore file per slopscore.org. It commits one file, slopscore.md, with six lines of disclosures in it. That's the whole job.";

export function HowToClip(props: { caption?: string } = {}) {
  return (
    <figure class="howto">
      <video autoplay muted loop playsinline preload="metadata" poster="/media/add-to-slopscore.jpg" width="720" height="405" aria-label={HOWTO_ALT}>
        <source src="/media/add-to-slopscore.mp4" type="video/mp4" />
        <img src="/media/add-to-slopscore.gif" alt={HOWTO_ALT} width="720" height="405" loading="lazy" />
      </video>
      <figcaption>{props.caption ?? <>Tell your agent: <em>add a slopscore file per slopscore.org.</em> It commits one file. That's the whole job.</>}</figcaption>
    </figure>
  );
}
