# Mobile Navbar Dark Glass Dock Design

## Summary

Redesign the mobile bottom navigation only. Keep the current menu structure and route behavior, but replace the existing full-width mobile bar and attached center FAB with a dark liquid-glass floating dock and a detached right-side FAB.

## Scope

In scope:

- Mobile navigation visual treatment in `Layout`.
- Mobile navigation CSS in `index.css`.
- FAB placement, styling, and press feedback on mobile.
- Active nav item visual state and tap feedback.
- Safe-area spacing so content and controls stay clear of the iOS/Android bottom area.

Out of scope:

- Desktop sidebar changes.
- Menu order or route changes.
- Changing what the FAB does on each route.
- Reworking page content, cards, charts, or data flows.

## Visual Direction

Use the selected "Dark Glass Dock" direction:

- A compact pill-shaped dock floats near the bottom-left/bottom-center instead of spanning the full viewport width.
- The dock uses a dark translucent surface with blur, subtle saturation, a thin light border, and a soft shadow.
- The FAB is a separate circular button on the bottom-right, with visible spacing between it and the dock.
- The design keeps Keuanganku's dark concrete base and acid-green accent while softening the mobile navigation into a more premium glass surface.

## Interaction Design

The four existing nav items remain inside the dock:

- Dashboard
- History
- Recurring
- Settings

The active item receives a small rounded bubble with a subtle green glow. Inactive icons stay muted. Labels can remain visually available if they fit cleanly, but the design should prioritize icon clarity and avoid cramped text. Tap feedback should be lightweight: nav items scale down slightly and return quickly; the dock itself should not jump or resize.

The FAB remains route-aware:

- Dashboard and default routes: add expense icon/action.
- History: insight icon/action.
- Recurring: recurring expense icon/action.

The FAB sits outside the dock on the right, uses the same dark glass family, and gets a slightly stronger press response than nav items. Its icon should still animate when the route changes, using the existing pop/rotate behavior.

## Implementation Notes

The implementation should preserve the existing route logic in `Layout.tsx` and mostly change the JSX wrapper/classes for the mobile nav area. Prefer CSS classes in `index.css` for the new dock, nav item, active state, and detached FAB styles. Keep desktop `.fab` behavior unchanged.

Use fixed, stable dimensions for the mobile nav area:

- A bottom fixed wrapper that respects `env(safe-area-inset-bottom)`.
- A dock width calculated to leave room for the detached FAB.
- A fixed FAB diameter so route-specific icons do not shift layout.

## Edge Cases

- On narrow mobile widths, the dock and FAB must not overlap.
- The dock should not cover critical bottom-sheet controls.
- The portfolio route currently hides the mobile nav/FAB; keep that behavior.
- History route manages its own scroll container; keep existing scroll restoration behavior untouched.
- Reduced-motion users should still get usable tap states without route-change animation reliance.

## Testing

Verify with:

- `npm run build`
- Browser check at a mobile viewport around 390 x 844.
- At least these routes: Dashboard, History, Recurring, Settings, and Pockets.
- Confirm FAB icon/action changes by route.
- Confirm mobile nav remains hidden on portfolio routes as it does today.
- Confirm text/icons do not overlap the dock, FAB, or safe-area region.

## Spec Self-Review

- No placeholders remain.
- Scope is limited to mobile navbar visual and interaction design.
- Route behavior is explicitly preserved.
- Desktop sidebar and app data behavior are explicitly out of scope.
- Testing covers build, mobile rendering, route-specific FAB behavior, and the portfolio exception.
