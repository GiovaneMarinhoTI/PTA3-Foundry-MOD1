import PtaActorSheet from "../actor.mjs";

export default class PtaNpcSheet extends PtaActorSheet {
    static DEFAULT_OPTIONS = {
        classes: ["character"],
        window: {
            controls: [{
                icon: 'fas fa-dice-d6',
                label: 'PTA.Button.GenerateNpcSprite',
                action: 'generateNpcSprite',
                ownership: 3
            }]
        },
        actions: {
            generateNpcSprite: this._onGenerateNpcSprite,
        }
    }

    static PARTS = {

    }

    static TABS = {

    }

    tabGroups = {

    }

    static async _onGenerateNpcSprite() {
        const module = game.modules.get("pokemon-assets");
        if (!module?.active) return ui.notifications.warn(game.i18n.localize("PTA.Error.PokemonAssetsNotActive") || "Pokemon Assets module is not active.");
        const api = module.api;
        if (!api?.PokemonSheets) return ui.notifications.warn(game.i18n.localize("PTA.Error.PokemonAssetsApiUnavailable") || "Pokemon Assets API not available.");

        const allKeys = Array.from(api.PokemonSheets.allSheetKeys?.() ?? []);
        const trainerKeys = allKeys.filter((k) => k.startsWith("modules/pokemon-assets/img/trainers-overworld/"));
        if (!trainerKeys.length) return ui.notifications.warn("No trainer sprites were found in Pokemon Assets.");

        const tokenSrc = trainerKeys[Math.floor(Math.random() * trainerKeys.length)];
        const tokenSettings = api.PokemonSheets.getTokenChangesForSpritesheet(tokenSrc);
        if (!tokenSettings) return ui.notifications.warn("Could not generate a trainer token from Pokemon Assets.");

        let profileSrc = tokenSrc.replace("modules/pokemon-assets/img/trainers-overworld/", "modules/pokemon-assets/img/trainers-profile/");
        try {
            const response = await fetch(profileSrc, { method: 'HEAD' });
            if (!response.ok) profileSrc = tokenSrc;
        } catch {
            profileSrc = tokenSrc;
        }

        await this.document.update({ img: profileSrc, prototypeToken: tokenSettings });
        ui.notifications.info(game.i18n.localize("PTA.Button.GenerateNpcSprite"));
    }
    
}