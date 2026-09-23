import { OpenAiCompatibleProvider } from './openAiCompatible.js';
import { ConnectionProfileProvider } from './connectionProfile.js';
import { OllamaProvider } from './ollama.js';
import { ServerProxyProvider } from './serverProxy.js';
import { SillyTavernProvider } from './sillyTavern.js';

export function createProvider(settings, context) {
    switch (settings.provider) {
        case 'openai': return new OpenAiCompatibleProvider(settings, context);
        case 'ollama': return new OllamaProvider(settings, context);
        case 'connectionProfile': return new ConnectionProfileProvider(settings, context);
        case 'sillytavern': return new SillyTavernProvider(settings, context);
        case 'server':
        default: return new ServerProxyProvider(settings, context);
    }
}
