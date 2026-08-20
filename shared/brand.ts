/**
 * Deutsche Bahn corporate colour, for the handful of places that cannot use a
 * CSS class.
 *
 * In markup, use the `primary` utilities — `bg-primary`, `text-primary`,
 * `border-primary`, `ring-primary`. They resolve through `--primary` in
 * client/src/index.css and are the only correct way to paint brand red.
 * This constant exists solely for surfaces that take a colour *string*:
 * Leaflet marker options and the popup HTML it renders into a canvas-managed
 * container, where no stylesheet applies.
 *
 * It was 113 copies of "#FF0000" spread over 17 files, plus one "#E6002B" in
 * the Button variant that nothing else used — so the primary action colour and
 * its hover were two different reds depending on which component you looked at.
 * None of them was the DB brand colour: Deutsche Bahn publish their palette as
 * open source (github.com/db-ui/core, $db-color-red-500 = #EC0016) and pure
 * #FF0000 is an approximation that appears on third-party colour sites but not
 * in DB's own tokens. It is also the inaccessible one — white on #FF0000 is
 * 4.00:1, below the WCAG AA floor; white on #EC0016 is 4.59:1.
 *
 * brand.test.ts asserts this value against the `--primary` declaration in
 * index.css, so the constant and the token cannot drift apart.
 */
export const DB_RED = "#EC0016";

/** The same colour at low alpha, for popup chip backgrounds. */
export const DB_RED_SUBTLE = "rgba(236,0,22,0.06)";

/** Marker ring colour on the map. */
export const DB_RED_RING = "rgba(236,0,22,0.30)";
