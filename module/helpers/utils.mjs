import PtaDialog from "../applications/dialog.mjs";
import pokeapi from "./pokeapi.mjs";
import { PTA } from "./config.mjs";

// Custom API URL for fetching attack details (range, frequency, description)
const CUSTOM_ATTACK_API_URL = "http://164.152.48.205:25565/api/ataques/";
// Custom API URL for fetching passive details
const CUSTOM_PASSIVE_API_URL = "http://164.152.48.205:25565/api/passivas/";

/**
 * @typedef {Object} NotifyOptions
 * @prop {Boolean} permanent - should the mssage be displayed until manually dismissed
 * @prop {Boolean} localize - should the message be localize
 * @prop {Boolean} console - Should this notification be logged to console
 */

export default class utils {
    //============================================================
    //> Notifications
    //============================================================

    static info(message, options) {
        ui.notifications.info(this.localize(message), options);
    }
    static warn(message, options) {
        ui.notifications.warn(this.localize(message), options);
    }
    static error(message, options) {
        ui.notifications.error(this.localize(message), options);
    }

    //============================================================
    //> Localization
    //============================================================
    static localize(str) { return game.i18n.localize(str); }
    static format(str, data) { return game.i18n.format(str, data); }

    //============================================================
    //> Data manipulation
    //============================================================

    /**
     * Lightweight system for duplicating non complex data structurs
     * @param {JSON} data 
     * @returns {Object}
     */
    static duplicate(data) {
        return JSON.parse(JSON.stringify(data));
    }

    /**
     * Heavy duty data cloning capable of matching functions, classes, and proxies
     * @param {*} data 
     */
    static clone(data) {

    }

    //============================================================
    //> Pokemon functions
    //============================================================

    /**
     * @param {Object} options -
     * @param {String|null} options.name - if we already got a name, we can avoid prompting for one
     * @param {Boolean} options.forms -
     * @param {Boolean} options.species - 
     * @param {Boolean} options.moves - 
     * @returns 
     */
    static async importPokemonData(options = {}) {

        options = Object.assign({
            forms: false,
            species: false,
            moves: false,
            all: false,
            name: null
        }, options)

        try {
            // get the pokemon name to import with
            if (!options.name || options.name == '') {
                options.name = await new Promise(async (resolve, reject) => {
                    const app = await new PtaDialog({
                        window: { title: "PTA.Dialog.PokemonImporter" },
                        content: `
                        <input type="text" class="pokemon-name" placeholder="${this.localize(PTA.generic.pokemon)}">
                        <div class="form-group">
                            <label>Moves</label>
                            <div class="form-fields">
                                <input type="checkbox" name="moves">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Species</label>
                            <div class="form-fields">
                                <input type="checkbox" name="species">
                            </div>
                        </div>
                        <div class="form-group">
                            <label>Forms</label>
                            <div class="form-fields">
                                <input type="checkbox" name="forms">
                            </div>
                        </div>
                    `,
                        buttons: [{
                            label: "Confirm",
                            action: "confirm",
                            callback: () => { resolve(app.element.querySelector('.pokemon-name')?.value); app.close(); }
                        }, {
                            label: "Cancel",
                            action: "cancel",
                            callback: () => { reject(null); app.close() }
                        }],
                        submit: () => { resolve(app.element.querySelector('.pokemon-name')?.value); app.close(); }
                    }).render(true);
                })
            }

            if (!options.name || options.name == '') return void pta.utils.warn('PTA.Warn.NeedPokemonName');

            // format the name a bit
            options.name = options.name.replace(/\s+/g, '-');

            this.info('PTA.Info.PleaseWaitImporting');

            // import the pokemon
            let pokemon = await pokeapi.pokemon(options.name);
            if (options.all || options.species) pokemon.species = await pokeapi.request(pokemon.species.url);
            if (options.all || options.forms) for (let i = 0; i < pokemon.forms.length; i++) pokemon.forms[i] = await pokeapi.request(pokemon.forms[i].url);
            if (options.all || options.moves) {
                for (let i = 0; i < pokemon.moves.length; i++) {
                    pokemon.moves[i] = await pokeapi.request(pokemon.moves[i].move.url);
                }
            }

            this.info('PTA.Info.ImportComplete');
            return pokemon;
        } catch (err) {
            console.error(err)
            return null;
        }
    }

    static parsePokemonSpecies() {

    }

    /**
     * converts given pokemon data into useable vtt data
     */
    static parsePokemonData(pokemon) {
        try {
            const data = {
                hp: { max: Math.round(pokemon.stats.find((s) => { return s.stat.name == 'hp' }).base_stat / 10) * game.settings.get(game.system.id, 'healthMult') },
                stats: {
                    atk: { value: Math.round(pokemon.stats.find((s) => { return s.stat.name == 'attack' }).base_stat / 10) },
                    def: { value: Math.round(pokemon.stats.find((s) => { return s.stat.name == 'defense' }).base_stat / 10) },
                    spd: { value: Math.round(pokemon.stats.find((s) => { return s.stat.name == 'speed' }).base_stat / 10) },
                    satk: { value: Math.round(pokemon.stats.find((s) => { return s.stat.name == 'special-attack' }).base_stat / 10) },
                    sdef: { value: Math.round(pokemon.stats.find((s) => { return s.stat.name == 'special-defense' }).base_stat / 10) },
                },
                types: {
                    primary: pokemon.types[0].type.name,
                    secondary: pokemon.types[1] ? pokemon.types[1].type.name : 'none'
                },
                species: pokemon.species.name,
            };

            return data;
        } catch (err) {
            return void console.error('recieved invalid pokemon data to parse', err)
        }
    }

    static parseMoveData(move) {
        function getFlavorText(entries, options = {}) {
            if (!entries) return '';
            for (const entry of entries) {
                if (entry.version_group.name == options.version) return entry.flavor_text;
                if (entry.language.name == game.i18n.lang || entry.language.name == options.lang) return entry.flavor_text
            }
            return '';
        }

        try {
            // Determine the formula based on damage class
            // Damage classes from API: 'physical', 'special', 'status'
            let damageFormula = `${Math.floor(move.power / 20)}d6`;
            
            // Add the appropriate stat modifier based on damage class
            if (move.damage_class.name === 'physical') {
                damageFormula += ' + @atk';
            } else if (move.damage_class.name === 'special') {
                damageFormula += ' + @satk';
            } else if (move.damage_class.name === 'status') {
                damageFormula += ' + @spd';
            } else {
                damageFormula += ' + @atk'; // default to physical
            }
            
            console.log('PTA3: parseMoveData - Move:', move.name, 'Damage Class:', move.damage_class.name, 'Formula:', damageFormula);

            return {
                category: move.damage_class.name,
                type: move.type.name,
                priority: move.priority,
                damage: {
                    formula: damageFormula
                },
                accuracy: Math.min((move.accuracy - 100) / 5, 0) || 0,
                ailment: {
                    chance: move.meta?.ailment_chance || 0,
                    type: this._apiAilmentConversion(move.meta?.ailment.name)
                },
                drain: move.meta?.drain || 0,
                critical_chance: move.meta?.crit_rate || 0,
                multi_hit: {
                    max: move.meta?.max_hits || 0,
                    min: move.meta?.min_hits || 0
                },
                description: getFlavorText(move.flavor_text_entries),
                // Range and frequency will be populated from custom API if available
                range: '5',
                frequency: 'At-Will'
            };

        } catch (err) {
            return void this.error('recieved invalid move data to parse', err)
        }
    }

    static _apiAilmentConversion(ailment) {
        if (Object.hasOwn(PTA.apiConvertAilment, ailment)) return PTA.apiConvertAilment[ailment];
        else return 'none';
    }

    /**
     * Fetches attack data from the custom API
     * @param {string} attackName - The name of the attack to fetch
     * @returns {Object|null} - Object with range, frequency, and description or null if failed
     */
    static async fetchCustomAttackData(attackName) {
        try {
            // Convert to title case and URL encode spaces (e.g., "thunder-wave" -> "Thunder%20Wave")
            const titleCaseName = this.toTitleCase(attackName.replace(/-/g, ' '));
            const encodedName = encodeURIComponent(titleCaseName);
            console.log(`[v0] Custom API: Fetching attack data for "${attackName}" -> "${titleCaseName}" -> "${encodedName}"`);
            const response = await fetch(CUSTOM_ATTACK_API_URL + encodedName);
            if (!response.ok) {
                console.warn(`[v0] Custom API: Attack ${attackName} not found (status: ${response.status})`);
                return null;
            }
            const data = await response.json();
            
            console.log(`[v0] Custom API: Found attack data for ${attackName}:`, data);
            console.log(`[v0] Custom API: Range value from API:`, data.Range, typeof data.Range);
            
            // Ensure range is a string (can be "melee", "20", etc.)
            const rangeValue = data.Range !== undefined && data.Range !== null 
                ? String(data.Range) 
                : '5';
            
            console.log(`[v0] Custom API: Final range value:`, rangeValue);
            
            return {
                range: rangeValue,
                frequency: data.Frequency || 'At-Will',
                description: data.Effect || data.Description || ''
            };
        } catch (error) {
            console.error(`[v0] Custom API: Error fetching attack data for ${attackName}:`, error);
            return null;
        }
    }

    /**
     * Fetches passive data from the custom API
     * @param {string} passiveName - The name of the passive to fetch
     * @returns {Object|null} - Object with name and description or null if failed
     */
    static async fetchCustomPassiveData(passiveName) {
        try {
            // Convert to title case and URL encode spaces (e.g., "static" -> "Static")
            const titleCaseName = this.toTitleCase(passiveName.replace(/-/g, ' '));
            const encodedName = encodeURIComponent(titleCaseName);
            console.log(`[v0] Custom API: Fetching passive data for "${passiveName}" -> "${titleCaseName}" -> "${encodedName}"`);
            const response = await fetch(CUSTOM_PASSIVE_API_URL + encodedName);
            if (!response.ok) {
                console.warn(`[v0] Custom API: Passive ${passiveName} not found (status: ${response.status})`);
                return null;
            }
            const data = await response.json();
            
            console.log(`Custom API: Found passive data for ${passiveName}:`, data);
            return {
                name: data.Name || passiveName,
                description: data.Effect || data.Description || ''
            };
        } catch (error) {
            console.error(`Custom API: Error fetching passive data for ${passiveName}:`, error);
            return null;
        }
    }

    static HonourLevel(num) {
        num += 1;
        let level = 1;
        let cost = 1;
        let count = 0;
        while (num > cost) {
            num -= cost;
            level += 1;
            count += 1;
            if (count >= 3) {
                count = 0;
                cost = Math.min(cost + 1, 5);
            }
        }
        return level;
    }

    static toTitleCase(str) {
        return str.replace(
            /\w\S*/g,
            text => text.charAt(0).toUpperCase() + text.substring(1).toLowerCase()
        );
    }

    static fuzzyMatch(str, term, ratio) {
        var string = str.toLowerCase();
        var compare = term.toLowerCase();
        var matches = 0;
        if (string.indexOf(compare) > -1) return true;
        for (var i = 0; i < compare.length; i++) {
            string.indexOf(compare[i]) > -1 ? matches += 1 : matches -= 1;
        }
        return (matches / str.length >= ratio || term == "")
    }

    static randomNature(options = {}) {
        let _options = {
            use: [],
            ban: [],
            neutral: true
        };
        // if only a boolean was passed, use it to decide neutrals
        if (typeof options == "boolean") options = { neutral: options }
        options = Object.assign(_options, options);

        // create a roster of valid natures to use
        let choices = [];
        if (options.use.length > 0) choices = options.use;
        else if (options.neutral) choices = Object.keys(pta.config.natures);
        else {
            choices = Object.keys(pta.config.natures);
            for (const i of Object.keys(pta.config.natureNeutral)) options.ban.push(i);
        }

        // check if neutral natures ahve been turned on
        if (!game.settings.get(game.system.id, 'neutralNatures')) {
            for (const a in pta.config.natureNeutral) options.ban.push(a);
        }

        for (const i of options.ban) {
            let index = 0;
            while (index > -1) {
                index = choices.indexOf(i);
                if (index < 0) break;
                choices.splice(index, 1);
            }
        }

        return choices[Math.floor(Math.random() * choices.length)];
    }

    /**
     * Converts the effectiveness level
     * @param {Array|String} attacker
     * @param {Array|String} defender 
     * @returns {Object}
     */
    static typeEffectiveness(attacker = [], defender = []) {
        if (!attacker || !defender) return null;
        if (!Array.isArray(attacker)) attacker = [attacker];
        if (!Array.isArray(defender)) defender = [defender];

        const data = {
            value: 0,
            percent: 1,
            immune: false,
        }

        // loop attack types
        for (const a of attacker) {
            // skip invalid attacker types
            if (!Object.keys(PTA.pokemonTypes).includes(a)) continue;
            // loop through defender types
            for (const d of defender) {
                // skip invalid defender types
                if (!Object.keys(PTA.pokemonTypes).includes(d)) continue;
                // get the effectiveness value
                if (PTA.typeEffectiveness[d].double.includes(a)) { data.value += 1; data.percent *= 2 }
                if (PTA.typeEffectiveness[d].half.includes(a)) { data.value -= 1; data.percent /= 2 }
                if (PTA.typeEffectiveness[d].immune.includes(a)) data.immune = true;
            }
        }
        return data;
    }

    /**
     * Calculates the damage dealt based on type effectiveness
     * @param {Number} num 
     * @param {String} type 
     */
    static damageCalc(num, type) {

    }

    /**
     * converts a number from -6 to 6 into a stat booster
     * @param {Number} num 
     * @returns {Number}
     */
    static AbilityStage(num) {
        num = Math.max(Math.min(6, num), -6); // clamps the boost value to what is allowed
        if (num < 0) {
            return 2 / (2 + (num * -1));// convert number to positive, reduce damage by the reduciton value
        } else if (num > 0) {
            return (2 + num) / 2; // nice and easy
        }
        return 1;
    }

    /**
     * 
     * @param {Number} num 
     */
    static AccuracyStage(num) {
        num = Math.max(Math.min(6, num), -6); // clamps the boost value to what is allowed
        if (num < 0) {
            return 3 / (3 + (num * -1));// convert number to positive, reduce damage by the reduciton value
        } else if (num > 0) {
            return (3 + num) / 3; // nice and easy
        }
        return 1;
    }

    static CriticalStage(num) {
        let base = 24;
        if (num == 1) base = 8;
        else if (num == 2) base = 2;
        else if (num > 2) base = 1;
        return Math.ceil(1 / base);
    }

    //============================================================
    //> Math animation helpers
    //============================================================
    static lerp(x, y, t) {
        return x * (1 - t) + y * t;
    }

    static lerpPoint(x1, y1, x2, y2, t) {
        return {
            x: this.lerp(x1, x2, t),
            y: this.lerp(y1, y2, t)
        }
    }

    static fastBezier(x1, y1, x2, y2, t) {
        const x3 = x1;
        const y3 = y2;

        const a = {
            x: this.lerp(x1, x3, t),
            y: this.lerp(y1, y3, t)
        }

        const b = {
            x: this.lerp(x3, x2, t),
            y: this.lerp(y3, y2, t)
        }

        return { x: this.lerp(a.x, b.x, t), y: this.lerp(a.y, b.y, t) };
    }

    static quadraticBezier(x1, y1, x2, y2, x3, y3, t) {

    }

    //============================================================
    //> Combat
    //============================================================

    static getTargets() {
        const targets = [];
        for (const target of game.user.targets) {
            targets.push({
                target: target,
                actor: target.actor,
                token: target.document
            })
        }
        if (targets.length <= 0) return null;
        return targets;
    }

    //============================================================
    //> Dom manipulation
    //============================================================
    static async renderTemplate(path, data) {
        return foundry.applications.handlebars.renderTemplate(path, data);
    }
}
