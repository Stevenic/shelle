import { listPages } from "../pages";
import {loadSettings, saveSettings } from "../settings";
import { Application } from 'express';
import { SynthOSConfig } from "../init";
import { availableModels, createCompletePrompt } from "./createCompletePrompt";
import { generateDefaultImage, generateImage } from "./generateImage";
import { chainOfThought } from "agentm-core";
import { requiresSettings } from "./requiresSettings";
import { executeScript } from "../scripts";

export function useApiRoutes(config: SynthOSConfig, app: Application): void {
    // List pages
    app.get('/api/pages', async (req, res) => {
        const pages = await listPages(config.pagesFolder, config.requiredPagesFolder);
        res.json(pages);
    });

    // Define a route to return settings
    app.get('/api/settings', async (req, res) => {
        const settings = await loadSettings(config.pagesFolder);
        res.json({...settings, availableModels});
    });

    // Define a route to save settings
    app.post('/api/settings', async (req, res) => {
        try {
            // Covert non-string values
            const settings = req.body as Record<string, any>;
            if (typeof settings.maxTokens === 'string') {
                settings.maxTokens = parseInt(settings.maxTokens);
            }
            if (typeof settings.logCompletions === 'string') {
                settings.logCompletions = settings.logCompletions === 'true';
            }

            // Save settings
            await saveSettings(config.pagesFolder, settings);
            res.redirect('/home');
        } catch (err: unknown) {
            console.error(err);
            res.status(500).send((err as Error).message);
        }
    });

    // Define a route to generate an image
    app.post('/api/generate/image', async (req, res) => {
        await requiresSettings(res, config.pagesFolder, async (settings) => {
            const { prompt, shape, style } = req.body;
            const { serviceApiKey, imageQuality, model } = settings;
            const response = model.startsWith('gpt-') ?
                await generateImage({ apiKey: serviceApiKey, prompt, shape, quality: imageQuality, style }) :
                await generateDefaultImage();
            if (response.completed) {
                res.json(response.value);
            } else {
                res.status(500).send(response.error?.message);
            }
        });
    });

    // Define a route to generate a completion using chain-of-thought
    app.post('/api/generate/completion', async (req, res) => {
        await requiresSettings(res, config.pagesFolder, async (settings) => {
            const { prompt, temperature } = req.body;
            const { maxTokens } = settings;
            const completePrompt = await createCompletePrompt(config.pagesFolder, req.body.model);
            const response = await chainOfThought({ question: prompt, temperature, maxTokens, completePrompt });
            if (response.completed) {
                res.json(response.value ?? {});
            } else {
                console.error(response.error);
                res.status(500).send(response.error?.message);
            }
        });
    });

    // Define a route for running configured scripts
    app.post('/api/scripts/:id', async (req, res) => {
        await requiresSettings(res, config.pagesFolder, async (settings) => {
            const { id } = req.params;
            const pagesFolder = config.pagesFolder;
            const scriptId = id;
            const response = await executeScript({ pagesFolder, scriptId, variables: req.body });
            if (response.completed) {
                // Return the response as text
                const value = (response.value?.output ?? (response.value?.errors ?? []).join('\n')).trim();
                res.set('Content-Type', 'text/plain');
                res.send(value);
            } else {
                console.error(response.error);
                res.status(500).send(response.error);
            }
        });
    });
}