// Animated tutor avatar (original illustration). Blinks, and moves her mouth while speaking.
// Usage: element.innerHTML = tutorSVG();  add class "talking" to the parent to animate the mouth.
(function () {
  let n = 0;
  window.TUTOR_NAME = "Sara";
  window.tutorSVG = function (opts) {
    const id = "t" + n++;
    const round = !opts || opts.round !== false;
    const bg = !opts || opts.bg !== false;
    return `
<svg class="tutor-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#dbe7ff"/><stop offset="1" stop-color="#a9c2ff"/></linearGradient>
    <radialGradient id="${id}skin" cx="0.45" cy="0.4" r="0.7"><stop offset="0" stop-color="#f7d3b5"/><stop offset="1" stop-color="#e3a885"/></radialGradient>
    <linearGradient id="${id}hair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a2e1a"/><stop offset="1" stop-color="#2e160c"/></linearGradient>
    <linearGradient id="${id}top" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6cf6"/><stop offset="1" stop-color="#2447c9"/></linearGradient>
    ${round ? `<clipPath id="${id}c"><circle cx="100" cy="100" r="100"/></clipPath>` : `<clipPath id="${id}c"><rect width="200" height="200"/></clipPath>`}
  </defs>
  <g clip-path="url(#${id}c)">
    ${bg ? `<rect width="200" height="200" fill="url(#${id}bg)"/><circle cx="160" cy="40" r="46" fill="#ffffff" opacity=".25"/>` : ""}
    <!-- hair back -->
    <path d="M48 98c-4-44 20-70 52-70s58 24 54 70c-2 26 4 48 10 70H40c6-22 10-44 8-70z" fill="url(#${id}hair)"/>
    <!-- body -->
    <path d="M22 210c4-38 34-58 78-58s74 20 78 58z" fill="url(#${id}top)"/>
    <path d="M78 156q22 18 44 0" fill="none" stroke="#1e3a8a" stroke-width="3" opacity=".35"/>
    <!-- neck -->
    <path d="M86 128h28v24q-14 10-28 0z" fill="#e0a27f"/>
    <path d="M86 140q14 8 28 0" fill="none" stroke="#c98563" stroke-width="2" opacity=".5"/>
    <!-- ears + earrings -->
    <ellipse cx="62" cy="100" rx="7" ry="10" fill="#e8ad8b"/>
    <ellipse cx="138" cy="100" rx="7" ry="10" fill="#e8ad8b"/>
    <circle cx="62" cy="113" r="3.2" fill="#fbbf24"/>
    <circle cx="138" cy="113" r="3.2" fill="#fbbf24"/>
    <!-- face -->
    <path d="M64 92c0-26 16-42 36-42s36 16 36 42c0 26-16 44-36 44S64 118 64 92z" fill="url(#${id}skin)"/>
    <!-- hair front (side part) -->
    <path d="M60 96c-2-34 18-54 44-54 24 0 40 16 40 44-14-4-30-14-38-30-8 20-28 34-46 40z" fill="url(#${id}hair)"/>
    <path d="M134 70c6 10 8 22 6 34" fill="none" stroke="#2e160c" stroke-width="5" stroke-linecap="round"/>
    <!-- brows -->
    <path d="M78 84q8-5 16-1M106 83q8-4 16 1" stroke="#3b1f12" stroke-width="3" fill="none" stroke-linecap="round"/>
    <!-- eyes -->
    <g class="t-eyes">
      <ellipse cx="86" cy="95" rx="6" ry="6.5" fill="#fff"/>
      <ellipse cx="114" cy="95" rx="6" ry="6.5" fill="#fff"/>
      <circle cx="87" cy="95.5" r="4.2" fill="#4b2e1e"/>
      <circle cx="115" cy="95.5" r="4.2" fill="#4b2e1e"/>
      <circle cx="87" cy="95.5" r="2" fill="#111"/>
      <circle cx="115" cy="95.5" r="2" fill="#111"/>
      <circle cx="88.5" cy="94" r="1.3" fill="#fff"/>
      <circle cx="116.5" cy="94" r="1.3" fill="#fff"/>
      <path d="M79 91q7-6 14 0M107 91q7-6 14 0" stroke="#2e160c" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    </g>
    <!-- nose -->
    <path d="M100 99q-3 10 0 12q3 1 5-1" stroke="#c98563" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <!-- cheeks -->
    <ellipse cx="77" cy="110" rx="7" ry="4" fill="#f19a8a" opacity=".35"/>
    <ellipse cx="123" cy="110" rx="7" ry="4" fill="#f19a8a" opacity=".35"/>
    <!-- mouth -->
    <path class="t-smile" d="M88 118q12 10 24 0q-12 4-24 0z" fill="#c2414b" stroke="#a3333c" stroke-width="1.5" stroke-linejoin="round"/>
    <g class="t-talk">
      <ellipse cx="100" cy="120" rx="9" ry="6" fill="#7f1d1d"/>
      <path d="M92 117q8-3 16 0" stroke="#fff" stroke-width="2.5" fill="none" stroke-linecap="round"/>
      <ellipse cx="100" cy="123.5" rx="5" ry="2.2" fill="#f87171"/>
    </g>
  </g>
</svg>`;
  };
})();
