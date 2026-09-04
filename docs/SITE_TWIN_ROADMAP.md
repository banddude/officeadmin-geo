# Site Twin Implementation Roadmap

## Milestone A: canonical model and provider interfaces

Deliver:

- semantic types,
- geometry types,
- image candidate type,
- observation type,
- fused-value confidence type,
- provider interfaces,
- geometry helpers,
- image ranking tests.

Exit criteria:

- provider-neutral core compiles and tests pass.

## Milestone B: Los Angeles geometry automation

Deliver:

- point/address geocode adapter,
- LA County parcel query,
- LA County 2023 building query,
- primary-building selection,
- conversion of feet to meters,
- provenance records,
- Corralitas integration fixture generated from live county data.

Exit criteria:

- one command resolves Corralitas into the correct parcel/building polygon and measured height.

## Milestone C: street imagery automation

Deliver:

- KartaView nearby search,
- normalized photo metadata,
- distance/bearing calculations,
- heading-based ranking,
- distinct-viewpoint selection,
- temporary image download helper,
- no-coverage behavior.

Exit criteria:

- one command either returns useful ranked street frames or explicitly reports no coverage without failing the rest of reconstruction.

## Milestone D: local AI extraction

Deliver:

- Ollama client,
- configurable model name,
- Gemma vision prompt,
- strict JSON parsing,
- observation validation,
- retry-on-invalid-output,
- raw analysis report.

Exit criteria:

- multiple images can be converted into normalized VisualObservation objects automatically.

## Milestone E: fusion engine

Deliver:

- weighted roof voting,
- dominant color/material fusion,
- positive-evidence site flags,
- facade-opening clustering,
- alternative/disagreement recording,
- confidence/provenance on final facts.

Exit criteria:

- deterministic tests cover agreement, disagreement, missing views, and duplicate images.

## Milestone F: stylized renderer

Deliver:

- parcel ground,
- building footprint extrusion,
- measured building height,
- flat/gable/hip/shed roof primitives,
- facade color mapping,
- windows and doors,
- road and sidewalk,
- stairs and retaining walls,
- low-poly vegetation,
- orbit/site/street/roof camera presets,
- debug overlays.

Exit criteria:

- fixture JSON renders without network access.

## Milestone G: Corralitas end-to-end run

Deliver:

- command preset for 2629 Corralitas Dr,
- live county geometry,
- automatic street imagery where available,
- local Gemma analysis where imagery exists,
- semantic JSON artifact,
- browser scene,
- reconstruction debug report.

Exit criteria:

- human visual review confirms the scene is recognizably the target property and materially better than generic Mapbox extrusion.

## Milestone H: automate additional imagery providers

After the first address works, add additional street-level adapters behind the same interface so coverage is not dependent on KartaView alone.

Candidate research adapters:

- Mapillary,
- Google Street View research adapter,
- Apple Look Around research adapter,
- other open street imagery.

Do not change core/fusion/renderer contracts to add a provider.

## Milestone I: ground segmentation and procedural site detail

Use high-resolution land-cover data and/or image segmentation to place:

- grass,
- paved areas,
- trees,
- shrubs,
- retaining walls,
- paths,
- stairs.

The long-term goal is automatic semantic reconstruction rather than generic parcel decoration.

## Milestone J: OfficeAdmin selected-site integration

Only after the standalone research prototype is convincing:

- add Site Twin model loading to `geo-map`,
- open Site Twin from selected jobs/sites,
- cache generated site models by property/version,
- leave OA auth/business logic in OfficeAdmin,
- leave reconstruction/rendering in this repository.
