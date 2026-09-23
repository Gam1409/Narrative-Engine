# SillyTavern Connection Profiles integration

Narrative Engine 0.3.0 uses the public `ConnectionManagerRequestService` exposed
by `SillyTavern.getContext()`. It does not switch the active global connection
and does not read, copy, or persist provider credentials.

## Request contract

The provider calls `sendRequest(profileId, messages, maxTokens, options,
overridePayload)` with streaming disabled, response extraction enabled, and the
profile's generation/instruct presets enabled. The only payload override is the
bounded Narrative Engine temperature.

The service resolves Chat Completion versus Text Completion, model, endpoint,
secret ID, preset, instruct template, proxy, and prompt post-processing from the
selected SillyTavern profile. This covers OpenRouter and other endpoints already
supported by Connection Manager.

Health checking is intentionally local (`getProfile` plus `validateProfile`) so
the Test connection button cannot cause a paid generation. Actual provider
availability is proven by the first PRE request.

## Upstream references

- `public/scripts/st-context.js`: exports `ConnectionManagerRequestService` in
  the public extension context.
- `public/scripts/extensions/shared.js`: profile listing, validation, and
  `sendRequest` implementation.
- `public/scripts/custom-request.js`: normalized chat/text request processing.
- https://docs.sillytavern.app/usage/api-connections/openrouter/
- https://docs.sillytavern.app/usage/core-concepts/connection-profiles/

The integration feature-detects the service and reports a bounded error when
Connection Manager is disabled, unavailable, or the saved profile was removed.
