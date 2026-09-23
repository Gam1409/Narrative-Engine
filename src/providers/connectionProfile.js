import { ProviderError } from './errors.js';
import { withTimeout } from './http.js';

function getService(context) {
    const service = context?.ConnectionManagerRequestService;
    if (!service || typeof service.sendRequest !== 'function') {
        throw new ProviderError('SillyTavern Connection Manager is unavailable. Enable it and reload SillyTavern.', {
            code: 'CONNECTION_MANAGER_UNAVAILABLE',
        });
    }
    return service;
}

/** Returns only display-safe profile metadata. Credentials stay inside SillyTavern. */
export function listConnectionProfiles(context) {
    const service = getService(context);
    if (typeof service.getSupportedProfiles !== 'function') return [];
    return service.getSupportedProfiles().map((profile) => ({
        id: String(profile.id || ''),
        name: String(profile.name || profile.id || 'Unnamed profile'),
        api: String(profile.api || ''),
        model: String(profile.model || ''),
    })).filter((profile) => profile.id);
}

export class ConnectionProfileProvider {
    constructor(settings, context) {
        this.settings = settings;
        this.context = context;
    }

    getProfile(service = getService(this.context)) {
        const profileId = String(this.settings.connectionProfileId || '').trim();
        if (!profileId) {
            throw new ProviderError('Select a SillyTavern connection profile for the Director.', {
                code: 'CONNECTION_PROFILE_REQUIRED',
            });
        }
        if (typeof service.getProfile !== 'function') return { id: profileId, name: profileId, model: '' };
        try {
            const profile = service.getProfile(profileId);
            if (!profile) throw new Error('Profile not found');
            return profile;
        } catch (error) {
            throw new ProviderError('The selected SillyTavern connection profile no longer exists.', {
                code: 'CONNECTION_PROFILE_MISSING', cause: error,
            });
        }
    }

    async complete(request) {
        const service = getService(this.context);
        const profile = this.getProfile(service);
        const timeout = withTimeout(request.signal, request.timeoutMs);
        try {
            const result = await service.sendRequest(
                profile.id,
                request.messages,
                request.maxTokens || 4096,
                {
                    stream: false,
                    signal: timeout.signal,
                    extractData: true,
                    includePreset: true,
                    includeInstruct: true,
                },
                { temperature: this.settings.temperature },
            );
            const content = typeof result === 'string' ? result : result?.content;
            if (typeof content !== 'string' || !content.trim()) {
                throw new ProviderError('The SillyTavern connection profile returned an empty response.', {
                    code: 'EMPTY_RESPONSE',
                });
            }
            return {
                content,
                usage: result?.usage || null,
                model: String(profile.model || profile.name || 'sillytavern-connection-profile').slice(0, 200),
            };
        } catch (error) {
            if (error instanceof ProviderError) throw error;
            const timeoutLike = error?.name === 'TimeoutError' || (error?.name === 'AbortError' && !request.signal?.aborted);
            throw new ProviderError(timeoutLike
                ? 'The SillyTavern connection profile request timed out.'
                : 'The SillyTavern connection profile request failed.', {
                code: timeoutLike ? 'TIMEOUT' : 'CONNECTION_PROFILE_ERROR',
                retryable: timeoutLike,
                cause: error,
            });
        } finally {
            timeout.dispose();
        }
    }

    async healthCheck() {
        const service = getService(this.context);
        const profile = this.getProfile(service);
        if (typeof service.validateProfile === 'function') {
            try {
                service.validateProfile(profile);
            } catch (error) {
                throw new ProviderError('The selected SillyTavern connection profile is invalid or unsupported.', {
                    code: 'CONNECTION_PROFILE_INVALID', cause: error,
                });
            }
        }
        return {
            ok: true,
            latencyMs: 0,
            details: {
                profileId: String(profile.id).slice(0, 200),
                profileName: String(profile.name || profile.id).slice(0, 200),
                model: String(profile.model || '').slice(0, 200),
            },
        };
    }
}
