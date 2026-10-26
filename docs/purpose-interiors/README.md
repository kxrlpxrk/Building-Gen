# BG-07A production plan evidence

These screenshots are captured through the real purpose selector and cancellable layout worker using the production Vite bundle, with ordinary read-only 2D plan previews. They are not separately drawn concept plans. Desktop and iPhone-sized Chromium are automated checks; physical Safari performance and VoiceOver still require device testing.

| Plan                                                      | Evidence                                                                      |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Viking Longhouse                                          | [Plan](viking-longhouse.png)                                                  |
| Small Medieval Cottage                                    | [Plan](medieval-cottage.png)                                                  |
| Workshop                                                  | [Plan](workshop.png)                                                          |
| Tavern/Inn                                                | [Plan](tavern-inn.png)                                                        |
| Eight-room Manor                                          | [Desktop](manor.png), [iPhone size](manor-iphone.png)                         |
| Trading Hall                                              | [Plan](trading-hall.png)                                                      |
| Norse Chieftain hall, 18 × 8 m main plus three extensions | [Desktop](norse-three-wings.png), [iPhone size](norse-three-wings-iphone.png) |
| T-shaped Farmhouse                                        | [Plan](t-farmhouse.png)                                                       |

```sh
npm run build
BG_E2E_PREVIEW=1 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e -- tests/purpose-layouts.spec.ts --project=desktop-chromium --project=iphone-chromium
```

Omit the executable override when using Playwright's installed browser. Test attachments retain the originals in `test-results/`. Room labels are rendering-only annotations; exact room area, wall thickness, openings and circulation come from existing canonical geometry. Preview/Cancel leaves all project records unchanged. The root README documents solver bounds, supported/unsupported shapes, safe replacement and the physical iPhone checklist.
