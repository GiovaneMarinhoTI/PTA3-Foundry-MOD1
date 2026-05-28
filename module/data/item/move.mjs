import ItemData from "../item.mjs";
import { PTA } from "../../helpers/config.mjs";
import utils from "../../helpers/utils.mjs";

const {
    ArrayField, BooleanField, IntegerSortField, NumberField, SchemaField, SetField, StringField
} = foundry.data.fields;

export default class MoveData extends ItemData {
    static defineSchema() {
        const isRequired = { required: true, nullable: false };
        const schema = super.defineSchema();

        // Remove unneccessary fields
        delete schema.quantity;

        // is this a physical, special, or effect move
        // moves that deal damage are still classified as physical / effect, such as ember
        const MoveClasses = {};
        for (const a in PTA.moveClass) MoveClasses[a] = pta.utils.localize(PTA.moveClass[a]);
        schema.category = new StringField({
            ...isRequired,
            blank: false,
            choices: { ...MoveClasses },
            initial: 'physical'
        })

        // Move typing
        const TypeChoices = {};
        for (const a in PTA.pokemonTypes) TypeChoices[a] = pta.utils.localize(PTA.pokemonTypes[a]);
        schema.type = new StringField({ ...isRequired, initial: 'normal', label: PTA.generic.type, choices: { ...TypeChoices } });

        // move damage
        schema.damage = new SchemaField({
            // normal data
            formula: new StringField({ ...isRequired, blank: false, initial: '2d6 + @atk', validate: (value) => Roll.validate(value), validationError: 'PTA.Error.InvalidFormula' }),
        })

        schema.range = new StringField({ 
            initial: '5',
            blank: true,
            label: 'Range'
        })

        // Frequency - how often can the move be used (e.g., "At-Will", "EOT", "Scene", etc.)
        schema.frequency = new StringField({ 
            ...isRequired, 
            initial: 'At-Will',
            blank: true,
            label: 'Frequency'
        })

        // additional crit chance
        schema.critical_chance = new NumberField({ initial: 0, ...isRequired, min: 0, max: 100 });

        // how many times can this move be used, set max to 0 for unlimited uses
        schema.uses = new SchemaField({
            value: new NumberField({ initial: 0 }),
            max: new NumberField({ initial: 0 }),
        })

        // Accuracy, a number added to accuracy roll, or if in sim, the strict percentile hit chance
        schema.accuracy = new NumberField({ ...isRequired, initial: 100 });

        // does this move heal the user for damage dealt
        schema.drain = new NumberField({ ...isRequired, initial: 0 });

        schema.aoe = new SchemaField({
            width: new NumberField({ initial: 0 }),
            length: new NumberField({ initial: 0 }),
            type: new StringField({
                initial: 'none',
                choices: { ...PTA.aoeTypes }
            })
        })

        const AilmentChoices = {};
        for (const a in PTA.ailments) AilmentChoices[a] = utils.localize(PTA.ailments[a]);
        schema.ailment = new SchemaField({
            type: new StringField({
                blank: true,
                initial: null,
                nullable: true,
                choices: AilmentChoices,
                label: PTA.generic.ailment
            }),
            chance: new NumberField({ initial: 0, label: PTA.generic.chance })
        })

        // if max or min hits is set to 0, the move isnt treated as a multi hit
        schema.multi_hit = new SchemaField({
            max: new NumberField({ initial: 0 }),
            min: new NumberField({ initial: 0 })
        })

        schema.priority = new NumberField({ initial: 0, ...isRequired });

        return schema;
    }

    static migrateData(source) {
        // Corrects status ailment issues
        if (source.ailment && !Object.keys(PTA.ailments).includes(source.ailment.type)) source.ailment = { type: null, chance: 0 };

        // corrects category issues
        if (source.category && !Object.keys(PTA.moveClass).includes(source.category)) source.category = Object.keys(PTA.moveClass)[0];

        return super.migrateData(source);
    }

    get isRanged() { return this.range > 5 };

    getRollData() {
        const data = super.getRollData();
        let stat_key = 'atk'
        switch (this.category) {
            case 'special':
                stat_key = 'satk';
                break;
            case 'status':
                stat_key = 'spd'
                break;
        }
        
        console.log('PTA3: MoveData.getRollData called');
        console.log('PTA3: Move category:', this.category, 'stat_key:', stat_key);
        
        // Add the stat with the correct key for formula use
        if (data.actor?.system?.stats) {
            data.stat = {
                key: stat_key,
                ...data.actor.system.stats[stat_key]
            };
            
            // Also add all stat modifiers directly for formula compatibility
            data.atk = data.actor.system.stats.atk?.mod ?? 0;
            data.satk = data.actor.system.stats.satk?.mod ?? 0;
            data.def = data.actor.system.stats.def?.mod ?? 0;
            data.sdef = data.actor.system.stats.sdef?.mod ?? 0;
            data.spd = data.actor.system.stats.spd?.mod ?? 0;
            
            console.log('PTA3: Stats added to rolldata:', {atk: data.atk, satk: data.satk, def: data.def, sdef: data.sdef, spd: data.spd});
        } else {
            console.warn('PTA3: No actor stats found in MoveData.getRollData!');
        }

        return data;
    }

    //=====================================================================================================
    //> Actions 
    //=====================================================================================================
    async use(event, target, action) {
        if (action == 'reload') return this._onUseReload(event, target);
        return this._onUseAttack(event, target);
    }

    //=====================================================================================================
    //>- Attack 
    //=====================================================================================================
    async _onUseAttack(event, target) {
        if (this.uses.max > 0 && this.uses.value <= 0) return void utils.warn('PTA.Warn.NoUses');

        // gather relevant data
        const attacker = this.actor;
        if (!attacker) return void utils.warn('PTA.Warn.NoUser');

        const targets = utils.getTargets();
        const rolldata = this.getRollData();
        if (!rolldata) return void utils.error('PTA.Error.RolldataMissing');

        //============================================================================
        //>-- Roll attack for all targets
        //============================================================================
        if (!targets) return void utils.warn('PTA.Warn.EnforceTargeting');
        for (const target of targets) {
            //========================================================================
            //>--- Data prep
            //========================================================================
            let damage_formula = this.damage.formula;
            
            console.log('PTA3: _onUseAttack - Move category:', this.category);
            console.log('PTA3: _onUseAttack - Damage formula from item:', damage_formula);

            let target_defense = 0;
            if (this.category == 'physical') target_defense = target.actor.system.stats.def.value;
            if (this.category == 'special') target_defense = target.actor.system.stats.sdef.value;
            if (this.category == 'status') target_defense = target.actor.system.stats.spd.value;

            const message_config = { ...rolldata, user: attacker.name, move: this.parent.name, target: target.token.name };
            const message_data = { content: '', speaker: null }

            if (this.actor.type == 'pokemon' && this.actor.system.trainer != '') {
                // validate that theres a real trainer attached to this pokemon
                let trainer = await fromUuid(this.actor.system.trainer);
                if (!trainer) message_data.speaker = ChatMessage.getSpeaker({ actor: this.actor })
                else message_data.speaker = ChatMessage.getSpeaker({ actor: trainer })
            }

            //========================================================================
            //>--- Attack Roll (Accuracy Check)
            //========================================================================
            // Determine which stat to use based on move category
            let accuracyStat = 'atk'; // default to physical
            switch (this.category) {
                case 'special':
                    accuracyStat = 'satk';
                    break;
                case 'status':
                    accuracyStat = 'spd';
                    break;
            }
            
            console.log('PTA3: ========== ACCURACY CHECK ==========');
            console.log('PTA3: Move category:', this.category);
            console.log('PTA3: Determined accuracy stat:', accuracyStat);
            console.log('PTA3: Rolldata contents:', {atk: rolldata.atk, satk: rolldata.satk, spd: rolldata.spd});
            console.log('PTA3: Stat value from rolldata:', rolldata[accuracyStat]);
            
            // Create accuracy formula with correct stat
            const accuracyFormula = `1d20 + @${accuracyStat}`;
            console.log('PTA3: Accuracy formula created:', accuracyFormula);
            
            const r_accuracy = new Roll(accuracyFormula, rolldata);
            await r_accuracy.evaluate();
            
            console.log('PTA3: Accuracy roll terms:', r_accuracy.terms);
            console.log('PTA3: Accuracy roll result:', r_accuracy.total, 'vs Defense:', target_defense);
            console.log('PTA3: ========== END ACCURACY CHECK ==========');

            let missed = false;
            let critical = false;

            console.log('PTA3: Accuracy roll:', r_accuracy.total, 'vs Defense:', target_defense);

            if (r_accuracy.dice.find(a => a.faces == 20).results[0].result >= 20 - this.critical_chance) critical = true;
            else if (r_accuracy.total < target_defense) missed = true;

            // attack roll content
            message_data.content += `<p><b>${utils.localize(PTA.generic.accuracy)}</b></p>`
            if (missed) message_data.content += utils.format(PTA.chat.attack.miss, message_config);
            else if (critical) message_data.content += utils.format(PTA.chat.attack.crit, message_config);
            else message_data.content += utils.format(PTA.chat.attack.hit, message_config);
            message_data.content += await r_accuracy.render();

            //========================================================================
            //>--- Prepare Damage Roll Data (stored for button)
            //========================================================================
            console.log('PTA3: Creating damageData with moveId:', this.parent.id);
            console.log('PTA3: Attacker items:', attacker.items.map(i => ({ id: i.id, name: i.name })));
            
            const damageData = {
                attackerId: attacker.id,
                moveId: this.parent.id,
                moveUuid: this.parent.uuid,
                moveName: this.parent.name,
                targetId: target.actor.id,
                missed: missed,
                critical: critical,
                targetDefense: target_defense,
                category: this.category,
                type: this.type,
                drain: this.drain,
                ailmentType: this.ailment.type,
                ailmentChance: this.ailment.chance,
                damageFormula: damage_formula,
                stabBonus: false
            };

            // Add stab damage bonus flag if not missed
            if (!missed) {
                for (const key of Object.keys(attacker.system.types)) {
                    if (attacker.system.types[key] == this.type) {
                        damageData.stabBonus = true;
                        break;
                    }
                }
            }

            // Store damage data in message flags
            message_data.flags = {
                ptu: {
                    damageData: damageData
                }
            };

            //========================================================================
            //>--- Damage Action Button
            //========================================================================
            if (!missed) {
                message_data.content += `<p><button class="damage-roll-button" data-action="rollDamage" style="margin-top: 10px; padding: 8px 16px; background-color: #6c0303; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Roll Damage</button></p>`;
            }

            //======================================================================================================
            //>--- Chat Message
            //======================================================================================================
            message_data.content = await foundry.applications.ux.TextEditor.enrichHTML(message_data.content);
            let message = await r_accuracy.toMessage(message_data, message_config);

            // if we reach this point, attack was successful so we expend a use
            if (this.uses.max > 0) this.parent.update({ 'system.uses.value': this.uses.value - 1 });
        }
    }

    //=====================================================================================================
    async _onDamageRoll(message, damageData, attacker, moveItem) {
        console.log('PTA3: _onDamageRoll called');
        console.log('PTA3: Damage data:', damageData);
        console.log('PTA3: Move item passed:', moveItem?.name, 'UUID:', moveItem?.uuid);
        
        try {
            const targetActor = game.actors.get(damageData.targetId);
            if (!targetActor) {
                console.error('PTA3: Target actor not found');
                return;
            }

            // Build roll data with stat modifiers
            const rolldata = this.getRollData();
            
            // Ensure all stat modifiers are in rolldata
            if (attacker?.system?.stats) {
                rolldata.atk = attacker.system.stats.atk?.mod ?? 0;
                rolldata.satk = attacker.system.stats.satk?.mod ?? 0;
                rolldata.def = attacker.system.stats.def?.mod ?? 0;
                rolldata.sdef = attacker.system.stats.sdef?.mod ?? 0;
                rolldata.spd = attacker.system.stats.spd?.mod ?? 0;
                console.log('PTA3: Added stat modifiers to rolldata:', {atk: rolldata.atk, satk: rolldata.satk});
            }
            
            console.log('PTA3: Roll data prepared');

            //========================================================================
            //>--- Create damage roll
            //========================================================================
            let formula = damageData.damageFormula;
            console.log('PTA3: Initial formula:', formula);

            // Add STAB bonus if applicable
            if (damageData.stabBonus) {
                formula = formula + '+4';
                console.log('PTA3: Added STAB, new formula:', formula);
            }

            const r_damage = new Roll(formula, rolldata);
            console.log('PTA3: Roll object created:', r_damage.formula);

            //========================================================================
            //>--- Adjust dice for effectiveness
            //========================================================================
            let effectiveness = { value: 0, percent: 1, immune: false };
            
            if (targetActor.type == 'pokemon') {
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
                if (!overriden) {
                    console.log('PTA3: Calculating type effectiveness for', damageData.type, 'against', targetActor.system.getTypes());
                    effectiveness = utils.typeEffectiveness(damageData.type, targetActor.system.getTypes());
                    console.log('PTA3: Effectiveness result:', effectiveness);
                }
            }
            
            console.log('PTA3: Effectiveness:', effectiveness);

            // Adjust formula if there's an effectiveness modifier
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
            console.log('PTA3: Roll total:', r_final.total);

            //========================================================================
            //>--- Build damage message content
            //========================================================================
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

            //======================================================================================================
            //>--- Apply lifesteal
            //======================================================================================================
            if (damageData.drain > 0) {
                const healAmount = Math.floor(r_final.total * (damageData.drain / 100));
                damageContent += `<p>${attacker.name} recovers ${healAmount} HP!</p>`;
                console.log('PTA3: Applying lifesteal:', healAmount);
                await attacker.update({ 'system.hp.value': Math.min(attacker.system.hp.value + healAmount, attacker.system.hp.max) });
            }

            //======================================================================================================
            //>--- Apply ailments
            //======================================================================================================
            if (damageData.ailmentType && damageData.ailmentChance > 0) {
                console.log('PTA3: Checking ailment:', damageData.ailmentType);
                const r_ailment = new Roll('1d100');
                await r_ailment.evaluate();
                
                damageContent += `<p><b>Ailment Chance:</b> ${damageData.ailmentChance}%</p>`;
                
                if (r_ailment.total <= damageData.ailmentChance) {
                    damageContent += `<p>${targetActor.name} was affected!</p>`;
                    console.log('PTA3: Ailment applied!');
                    
                    if (game.user.isGM || targetActor.isOwner) {
                        await targetActor.toggleStatusEffect(damageData.ailmentType, { active: true, overlay: false });
                    }
                } else {
                    damageContent += `<p>${targetActor.name} resisted the ailment!</p>`;
                }
            }

            //======================================================================================================
            //>--- Send damage message
            //======================================================================================================
            damageContent = await foundry.applications.ux.TextEditor.enrichHTML(damageContent);
            const speaker = ChatMessage.getSpeaker({ actor: attacker });
            const damageMsg = await r_final.toMessage({
                flavor: damageContent,
                speaker: speaker
            });
            
            console.log('PTA3: Damage message created');

            //======================================================================================================
            //>--- Update original attack message
            //======================================================================================================
            const updatedContent = message.content.replace(/<button[^>]*class="damage-roll-button"[^>]*>.*?<\/button>/g, '');
            await message.update({ content: updatedContent });
            console.log('PTA3: Original message updated');

        } catch (err) {
            console.error('PTA3: Error in _onDamageRoll:', err);
            throw err;
        }
    }

    async _onUseReload(event, target) {
        if (this.uses.max > 0 && this.uses.value < this.uses.max) {
            this.parent.update({ system: { uses: { value: this.uses.max } } });
        }
    }
}
