import PokemonImporter from "../applications/apps/pokemon-importer.mjs";
import MoveImporter from "../applications/apps/move-importer.mjs";
import utils from "./utils.mjs";
import CompendiumBrowser from "../applications/apps/compendium-browser.mjs";
import { PTA } from "./config.mjs";

async function getRandomTrainerSprite() {
    const module = game.modules.get("pokemon-assets");
    if (!module?.active) return null;
    const api = module.api;
    if (!api?.PokemonSheets) return null;

    const allKeys = Array.from(api.PokemonSheets.allSheetKeys?.() ?? []);
    const trainerKeys = allKeys.filter((k) => k.startsWith("modules/pokemon-assets/img/trainers-overworld/"));
    if (!trainerKeys.length) return null;

    const tokenSrc = trainerKeys[Math.floor(Math.random() * trainerKeys.length)];
    const tokenSettings = api.PokemonSheets.getTokenChangesForSpritesheet(tokenSrc);
    if (!tokenSettings) return null;

    let profileSrc = tokenSrc.replace("modules/pokemon-assets/img/trainers-overworld/", "modules/pokemon-assets/img/trainers-profile/");
    try {
        const response = await fetch(profileSrc, { method: 'HEAD' });
        if (!response.ok) profileSrc = tokenSrc;
    } catch {
        profileSrc = tokenSrc;
    }

    return {
        img: profileSrc,
        prototypeToken: tokenSettings,
    };
}

async function assignRandomTrainerActor(actor) {
    if (!actor || actor.type !== 'npc') return;
    const randomSprite = await getRandomTrainerSprite();
    if (!randomSprite) return;

    const image = actor.img || null;
    const defaultIcon = "icons/svg/mystery-man.svg";
    if (image && image !== defaultIcon) return;

    await actor.update({
        img: randomSprite.img,
        prototypeToken: randomSprite.prototypeToken,
    });
}

/**
 * @callback HooksOn
 * @param {String} hook - the event to be called on
 * @param {Function} fn - the function to be triggered
 * @param {Object} options - options to customize the registered hook
 * @returns {Number} Id number of the registered hook
 */

/**
 * @callback HookOnce
 * @param {String} hook - the hook to be called on
 * @param {Function} fn - the function to be triggered
 */

/**
 * @callback HookOff
 * @param {String} hook - the event to unregister from
 * @param {Function|Number} fn - the function, or it's id number, to be disabled
 */

/**
 * @typedef {Object} Hooks
 * @prop {HooksOn} on - register a hook to be called
 * @prop {HookOnce} once - register a single use hook
 * @prop {HookOff} off - delist a hook from active duty
 */

export default function registerHooks() {
    const move_importer = new MoveImporter();
    
    //==========================================================================================================
    //> Damage Roll Button Handler
    //==========================================================================================================
    Hooks.on('renderChatMessage', async (message, html, data) => {
        try {
            console.log('PTA3: renderChatMessage hook fired for message:', message.id);
            
            // html might be jQuery object, convert to DOM if needed
            const htmlElement = html instanceof jQuery ? html[0] : html;
            console.log('PTA3: htmlElement type:', typeof htmlElement, 'is jQuery?', html instanceof jQuery);
            
            // Find the damage roll button
            const damageButton = htmlElement.querySelector('button.damage-roll-button');
            console.log('PTA3: Damage button found?', !!damageButton);
            
            if (damageButton) {
                console.log('PTA3: Found damage roll button, attaching event listener');
                
                damageButton.addEventListener('click', async (event) => {
                    event.preventDefault();
                    console.log('PTA3: ========================');
                    console.log('PTA3: DAMAGE BUTTON CLICKED!!!');
                    console.log('PTA3: ========================');
                    
                    const damageData = message.flags?.ptu?.damageData;
                    console.log('PTA3: Damage data retrieved:', damageData);
                    
                    if (!damageData) {
                        console.error('PTA3: Damage data not found in message flags');
                        ui.notifications.error('Damage data not found!');
                        return;
                    }

                    // Get the attacker and target actors
                    const attacker = game.actors.get(damageData.attackerId);
                    const targetActor = game.actors.get(damageData.targetId);
                    
                    console.log('PTA3: Got actors - Attacker:', attacker?.name, 'Target:', targetActor?.name);
                    
                    if (!attacker || !targetActor) {
                        console.error('PTA3: Actor not found - Attacker:', attacker?.name, 'Target:', targetActor?.name);
                        ui.notifications.error('Attacker or target actor not found!');
                        return;
                    }

                    // Get the move item from the attacker (not strictly needed anymore, but keeping for reference)
                    let moveItem = null;
                    
                    // Try to find by UUID first (for reference only)
                    if (damageData.moveUuid) {
                        try {
                            moveItem = await fromUuid(damageData.moveUuid);
                            console.log('PTA3: Got move item from UUID:', moveItem?.name);
                        } catch (err) {
                            console.log('PTA3: Could not get move item by UUID (this is OK, we have the data stored)');
                        }
                    }
                    
                    // Fallback to ID search if UUID failed
                    if (!moveItem) {
                        moveItem = attacker.items.get(damageData.moveId);
                        if (moveItem) {
                            console.log('PTA3: Got move item from ID:', moveItem?.name);
                        }
                    }
                    
                    console.log('PTA3: Move data available:', damageData.moveName);
                    console.log('PTA3: Move category:', damageData.category);

                    console.log('PTA3: About to roll damage for move:', damageData.moveName);

                    try {
                        const targetActor = game.actors.get(damageData.targetId);
                        
                        if (!targetActor) {
                            throw new Error('Target actor not found');
                        }

                        console.log('PTA3: Target types:', targetActor.system.getTypes ? targetActor.system.getTypes() : 'N/A');

                        // Build rolldata with correct stat based on attack category
                        const rolldata = attacker.getRollData();
                        
                        // Add the correct attack stat based on category
                        let attackStat = 'atk';
                        if (damageData.category === 'special') {
                            attackStat = 'satk';
                        } else if (damageData.category === 'status') {
                            attackStat = 'spd';
                        }
                        
                            console.log('PTA3: ========== DAMAGE ROLL ==========');
                            console.log('PTA3: Attack stat being used:', attackStat);
                            console.log('PTA3: Attacker stats before adding:', {atk: attacker.system.stats.atk?.mod, satk: attacker.system.stats.satk?.mod, spd: attacker.system.stats.spd?.mod});
                            
                            // Add the stat modifiers to rolldata
                            rolldata.atk = attacker.system.stats.atk?.mod ?? 0;
                            rolldata.satk = attacker.system.stats.satk?.mod ?? 0;
                            rolldata.def = attacker.system.stats.def?.mod ?? 0;
                            rolldata.sdef = attacker.system.stats.sdef?.mod ?? 0;
                            rolldata.spd = attacker.system.stats.spd?.mod ?? 0;
                            
                            console.log('PTA3: Rolldata stats after adding:', {atk: rolldata.atk, satk: rolldata.satk, spd: rolldata.spd});
                            console.log('PTA3: damageData.damageFormula received:', damageData.damageFormula);
                            console.log('PTA3: damageData.category received:', damageData.category);

                            // Roll the damage
                            let formula = damageData.damageFormula;
                            console.log('PTA3: Initial formula:', formula);

                            if (damageData.stabBonus) {
                                formula = formula + '+4';
                                console.log('PTA3: Added STAB bonus, formula now:', formula);
                            }

                            const r_damage = new Roll(formula, rolldata);
                            console.log('PTA3: Roll created with formula:', r_damage.formula);

                            // Calculate effectiveness using the utility function
                            let effectiveness = { value: 0, percent: 1, immune: false };
                            
                            if (targetActor.type == 'pokemon' && damageData.type) {
                                // Check for resistance overrides first
                                let overriden = false;
                                for (const override of targetActor.system.resistance_override) {
                                    if (override.type == damageData.type) {
                                        overriden = true;
                                        console.log('PTA3: Found resistance override for type:', damageData.type, 'value:', override.value);
                                        switch (override.value) {
                                            case 'immune': effectiveness = { value: 0, percent: 0, immune: true }; break;
                                            case 'double': effectiveness = { value: 1, percent: 2, immune: false }; break;
                                            case 'quadruple': effectiveness = { value: 2, percent: 4, immune: false }; break;
                                            case 'half': effectiveness = { value: -1, percent: 0.5, immune: false }; break;
                                            case 'quarter': effectiveness = { value: -2, percent: 0.25, immune: false }; break;
                                        }
                                }
                            }
                            
                            // If no override, use type effectiveness
                            if (!overriden) {
                                console.log('PTA3: Calculating type effectiveness for', damageData.type, 'against', targetActor.system.getTypes());
                                effectiveness = utils.typeEffectiveness(damageData.type, targetActor.system.getTypes());
                                console.log('PTA3: Effectiveness result:', effectiveness);
                            }
                        }

                        // Adjust formula based on effectiveness
                        if (effectiveness.value !== 0 && formula.includes('d')) {
                            const diceMatch = formula.match(/^(\d+)(d\d+)(.*)/);
                            if (diceMatch) {
                                const originalDiceCount = parseInt(diceMatch[1]);
                                const newDiceCount = Math.max(originalDiceCount + effectiveness.value, 0);
                                formula = `${newDiceCount}${diceMatch[2]}${diceMatch[3]}`;
                                console.log('PTA3: Adjusted formula - Changed from', originalDiceCount, 'dice to', newDiceCount, 'dice');
                                console.log('PTA3: New formula:', formula);
                            }
                        }

                        // Evaluate the roll
                        const r_final = new Roll(formula, rolldata);
                        await r_final.evaluate({ maximize: damageData.critical });
                        
                        console.log('PTA3: Damage roll evaluated');
                        console.log('PTA3: Formula used:', formula);
                        console.log('PTA3: Attack stat used: @' + attackStat, '= value', rolldata[attackStat]);
                        console.log('PTA3: Roll total:', r_final.total);
                        console.log('PTA3: ========== END DAMAGE ROLL ==========');

                        // Build message
                        let damageContent = `<p><b>Damage</b></p>`;
                        
                        if (effectiveness.immune) {
                            damageContent += `<p>${attacker.name}'s ${damageData.moveName} has no effect on ${targetActor.name}!</p>`;
                        } else {
                            switch (effectiveness.value) {
                                case -2: damageContent += `<p>It's not very effective...</p>`; break;
                                case -1: damageContent += `<p>It's not very effective...</p>`; break;
                                case 0: damageContent += `<p>It's a normal hit!</p>`; break;
                                case 1: damageContent += `<p>It's super effective!</p>`; break;
                                case 2: damageContent += `<p>It's super effective!</p>`; break;
                            }
                        }

                        // Send damage message with Apply Damage button
                        const finalDamage = effectiveness.immune ? 0 : r_final.total;
                        
                        // Add Apply Damage button if there's damage to apply
                        if (finalDamage > 0) {
                            damageContent += `<p><button class="apply-damage-button" data-damage="${finalDamage}" data-target-id="${damageData.targetId}" style="margin-top: 10px; padding: 8px 16px; background-color: #8B0000; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Apply Damage (${finalDamage})</button></p>`;
                        }
                        
                        damageContent = await foundry.applications.ux.TextEditor.enrichHTML(damageContent);
                        const speaker = ChatMessage.getSpeaker({ actor: attacker });
                        await r_final.toMessage({
                            flavor: damageContent,
                            speaker: speaker,
                            flags: {
                                ptu: {
                                    applyDamageData: {
                                        damage: finalDamage,
                                        targetId: damageData.targetId,
                                        attackerName: attacker.name,
                                        moveName: damageData.moveName
                                    }
                                }
                            }
                        });

                        // Update original message
                        const updatedContent = message.content.replace(/<button[^>]*class="damage-roll-button"[^>]*>.*?<\/button>/g, '');
                        await message.update({ content: updatedContent });

                        damageButton.disabled = true;
                        console.log('PTA3: Damage roll completed successfully!');
                    } catch (err) {
                        console.error('PTA3: Error rolling damage:', err);
                        console.error('PTA3: Error stack:', err.stack);
                        ui.notifications.error('Error rolling damage: ' + err.message);
                    }
                });
            }
            
            // Find the apply damage button
            const applyDamageButton = htmlElement.querySelector('button.apply-damage-button');
            
            if (applyDamageButton) {
                applyDamageButton.addEventListener('click', async (event) => {
                    event.preventDefault();
                    
                    const damage = parseInt(applyDamageButton.dataset.damage);
                    const targetId = applyDamageButton.dataset.targetId;
                    
                    const targetActor = game.actors.get(targetId);
                    
                    if (!targetActor) {
                        ui.notifications.error('Target not found!');
                        return;
                    }
                    
                    // Get current HP and calculate new HP
                    const currentHp = targetActor.system.health?.value ?? targetActor.system.hp?.value ?? 0;
                    const newHp = Math.max(0, currentHp - damage);
                    
                    // Update the target's HP
                    try {
                        if (targetActor.system.health !== undefined) {
                            await targetActor.update({ 'system.health.value': newHp });
                        } else if (targetActor.system.hp !== undefined) {
                            await targetActor.update({ 'system.hp.value': newHp });
                        }
                        
                        // Send confirmation message to chat
                        await ChatMessage.create({
                            content: `<p><b>${targetActor.name}</b> took <b>${damage}</b> damage! (HP: ${currentHp} → ${newHp})</p>`,
                            speaker: ChatMessage.getSpeaker()
                        });
                        
                        // Disable the button and update its appearance
                        applyDamageButton.disabled = true;
                        applyDamageButton.textContent = 'Damage Applied!';
                        applyDamageButton.style.backgroundColor = '#444';
                        applyDamageButton.style.cursor = 'default';
                        
                        // Update the message to remove the button
                        const updatedContent = message.content.replace(/<p><button[^>]*class="apply-damage-button"[^>]*>.*?<\/button><\/p>/g, '<p><i>Damage Applied!</i></p>');
                        await message.update({ content: updatedContent });
                        
                    } catch (err) {
                        console.error('PTA3: Error applying damage:', err);
                        ui.notifications.error('Error applying damage: ' + err.message);
                    }
                });
            }
        } catch (err) {
            console.error('PTA3: Error in renderChatMessage hook:', err);
            console.error('PTA3: Error stack:', err.stack);
        }
    });

    Hooks.on('renderItemDirectory', async (directory, element, data) => {
        /**@type {Element} */
        let ele = element.querySelector('.directory-footer.action-buttons');

        let button = document.createElement('BUTTON');
        button.innerHTML = utils.localize(`PTA.Button.ImportMove`);
        ele.appendChild(button);

        button.addEventListener('click', async () => {
            move_importer.render(true);
        })
    })

    const pokemon_importer = new PokemonImporter();
    const compendium_browser = new CompendiumBrowser();
    Hooks.on('renderActorDirectory', async (directory, element, data) => {

        //==============================================================================
        //> Render API import wizard
        //==============================================================================
        try {
            /**@type {Element} */
            let ele = element.querySelector('.directory-footer.action-buttons');

            const importButton = document.createElement('BUTTON');
            importButton.innerHTML = utils.localize(`PTA.Button.ImportPokemon`);
            ele.appendChild(importButton);

            importButton.addEventListener('click', async () => {
                pokemon_importer.render(true);
            })

            const npcButton = document.createElement('BUTTON');
            npcButton.innerHTML = utils.localize(`PTA.Button.GenerateNpcSprite`);
            ele.appendChild(npcButton);

            npcButton.addEventListener('click', async () => {
                try {
                    const randomSprite = await getRandomTrainerSprite();
                    if (!randomSprite) return ui.notifications.warn(game.i18n.localize("PTA.Error.NoTrainerSprites") || "No trainer sprites were found in Pokemon Assets.");

                    const tokenName = randomSprite.img?.split('/').pop()?.replace(/\.[^.]+$/, '') || "Random NPC";
                    await Actor.create({
                        name: `NPC ${utils.toTitleCase(tokenName.replace(/[-_]/g, ' '))}`,
                        type: 'npc',
                        img: randomSprite.img,
                        prototypeToken: randomSprite.prototypeToken,
                    });
                } catch (err) {
                    console.error('PTA3: Failed to create random NPC actor', err);
                    ui.notifications.error(game.i18n.localize("PTA.Error.RandomNpcCreateFailed") || "Failed to create a random NPC actor.");
                }
            })
        } catch (err) {
            console.error('Failed to append PokéApi footer in actor directory', err);
        }

        // CURRENTLY DISABLED DUE TO ERRORS
        //==============================================================================
        //> Render comepndium browser button
        //==============================================================================
        /*
        try {
            const cp_browser = document.createElement('BUTTON');
            cp_browser.innerHTML = utils.localize('PTA.Button.CompendiumBrowser');
            let header = element.querySelector('header.directory-header');
            let search = header.querySelector('search');
            header.insertBefore(cp_browser, search);

            cp_browser.addEventListener('click', async () => {
                compendium_browser.render(true);
            })
        } catch (err) {
            console.error('Failed to append compendium browser header in actor directory', err);
        }
        */
    });

    Hooks.on('createActor', async (actor, options, userId) => {
        try {
            if (!game.modules.get("pokemon-assets")?.active) return;
            await assignRandomTrainerActor(actor);
        } catch (err) {
            console.error('PTA3: Failed to assign random trainer sprite to new actor', err);
        }
    });

    //==========================================================================================================
    //> Developer links
    //==========================================================================================================
    Hooks.on('renderSettings', async (settings, html, context, options) => {
        try {
            const section = document.createElement('section');
            section.classList.add('flexcol');

            // create the divider header
            const divider = document.createElement('h4');
            divider.classList.add('divider');
            divider.textContent = 'System Developers';

            // System github
            const git = document.createElement('a');
            git.href = 'https://github.com/dragonkie/PTA3-FVTT';
            git.classList.add('button');
            git.innerHTML = `<i class="fa-brands fa-github"></i> Github`;

            // Developers patreon
            const patreon = document.createElement('a');
            patreon.href = 'https://www.patreon.com/cw/AstasArmoury';
            patreon.classList.add('button');
            patreon.innerHTML = `<i class="fa-brands fa-patreon"></i> Patreon`;

            // Ko-fi link
            const kofi = document.createElement('a');
            kofi.href = 'https://ko-fi.com/dragonkie';
            kofi.classList.add('button');
            kofi.innerHTML = `<i class="fas fa-coffee"></i> Ko-Fi`;

            // add everything together
            section.appendChild(divider);
            section.appendChild(git);
            section.appendChild(kofi);
            section.appendChild(patreon);

            // append it to the settings tab
            html.appendChild(section);
        } catch (err) {
            console.error('Failed to append developer support links');
        }
    })

}
