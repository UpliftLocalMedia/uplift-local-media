// ClientRouter swaps pages in without a full load, and a swapped-in <video>
// never fetches its src, doesn't autoplay, and doesn't pick up its `muted`
// attribute (which browsers need to allow autoplay). Start every matching
// video explicitly; reduced-motion visitors keep the poster instead.
export function playAutoplayVideos(selector: string) {
  const videos = document.querySelectorAll<HTMLVideoElement>(selector);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    videos.forEach((video) => video.pause());
    return;
  }
  videos.forEach((video) => {
    video.muted = true;
    if (video.readyState === HTMLMediaElement.HAVE_NOTHING) video.load();
    video.play().catch(() => {
      // Autoplay refused (e.g. data saver); the poster image stays visible.
    });
  });
}
