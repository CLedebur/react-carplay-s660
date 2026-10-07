# Revision D CPL

Generated 2026-09-18 through Konnect export_position_file, then converted to JLCPCB CSV columns: Designator, Mid X, Mid Y, Layer, Rotation. Units are mm; rotations are counterclockwise degrees normalized to 0–360. Native KiCad origin and Y-sign convention are preserved, including negative Y coordinates.

File: S660-PDB-revD-JLCPCB-CPL.csv. Pair with S660-PDB-revD-JLCPCB-BOM.csv.

Validation: 47 unique references, exact assembly-BOM coverage, all Top, matching footprint assignments. H1–H4 and TP1 were already absent from the native position export. All exported positions and rotations match the component list queried from the open board. U1 means the socket specified by the assembly BOM, not a factory-fitted MCU.

Saved board SHA-256: 151cb805e12d12449dae03072f4486b53dcbc136577996d24b8a7aea94839bd6.

Placement approval remains PREVIEW_REQUIRED. Coordinates are native KiCad footprint anchors; many through-hole footprints anchor at pin 1 rather than the body centre. No supplier-specific centroid offsets or rotation corrections have been guessed. JLCPCB must reconcile these against its selected package models in the placement preview. In particular, check U1/socket notch and pin 1, U2/Q2/Q3 pin order, diode/LED/capacitor polarity, K1 relay orientation and connector entry direction. This file has not yet been accepted or physically aligned in the JLCPCB portal and is not a machine-ready placement approval.

No board geometry was changed; no new DRC or full manufacturing release is claimed. Existing BOM sourcing and fit holds in BOM-SOURCING.md remain applicable. Regenerate placement data after any footprint movement or rotation.

Schema authority: [JLCPCB Pick & Place File for PCB Assembly](https://jlcpcb.com/help/article/pick-place-file-for-pcb-assembly), checked 2026-09-18. JLCPCB requires component centroids and final preview alignment; the native anchor qualification above must be resolved before assembly approval.
