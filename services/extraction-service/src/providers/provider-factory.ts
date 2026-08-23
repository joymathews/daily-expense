import { ILLMProvider } from '../types';
import { OllamaProvider } from './ollama-provider';
import { AzureOpenAIProvider } from './azure-openai-provider';
import { config } from '../config';

export class ProviderFactory {
  static createProvider(): ILLMProvider {
    if (config.llmProvider === 'azure-openai' && config.azureOpenAI.endpoint && config.azureOpenAI.apiKey) {
      return new AzureOpenAIProvider(
        config.azureOpenAI.endpoint,
        config.azureOpenAI.apiKey,
        config.azureOpenAI.deployment,
        config.azureOpenAI.apiVersion
      );
    }

    // Default to Ollama provider
    return new OllamaProvider(config.ollama.endpoint, config.ollama.model);
  }
}
