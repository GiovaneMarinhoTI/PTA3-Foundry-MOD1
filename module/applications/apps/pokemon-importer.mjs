import { PTA } from "../../helpers/config.mjs";
import pokeapi from "../../helpers/pokeapi.mjs";
import utils from "../../helpers/utils.mjs";
import PtaApplication from "../app.mjs";

// Custom API URL for fetching Pokemon moves and passives
const CUSTOM_API_URL = "http://164.152.48.205:25565/api/pokemons/";

export default class PokemonImporter extends PtaApplication {
    static DEFAULT_OPTIONS = {
        classes: ['importer'],
        window: {
            title: PTA.windowTitle.creatureImporter,
            icon: "fa-solid fa-download",
            minimizable: false,
            resizeable: false,
        },
        position: {
            width: 600,
            height: 800
        },
        actions: {
            search: this._onSearch,
            select: this._onSelect,
            submit: this._onSubmit,
            remove: this._onRemove,
        }
    }

    pokemon_selections = [];

    static get PARTS() {
        let p = {};
        p.main = { template: PTA.templates.app.importPokemon }
        return p;
    }

    async _prepareContext() {
        let context = super._prepareContext();
        context.id = this.id;
        return context;
    }

    static async _onSelect(event, target) {
        // get the relevant data ready to use
        const selection_list = this.element.querySelector('.pta-selection-list .wrapper');
        const pokemon_name = target.closest('[data-pokemon]').dataset.pokemon;

        // add the pokemon to our list of selections
        if (this.pokemon_selections.find((p) => p.name == pokemon_name)) return; // cancel if its already in lsit
        const pokemon = PTA.Pokedex.getPokemon(pokemon_name);
        if (!pokemon) return void utils.error(`PTA.Error.PokemonNotFound`);// validate we got a result
        this.pokemon_selections.push(pokemon);// add result to selections

        // add an element to the selection list so theu can be tracked / removed
        let ele = document.createElement('DIV');
        ele.setAttribute('data-pokemon', pokemon.name);
        selection_list.appendChild(ele);
        ele.innerHTML = `
            <a class="content-link" data-action="remove">${pokemon.name} <i class="fas fa-trash"></i></a>
        `;
    }

    static async _onRemove(event, target) {
        let element = target.closest('[data-pokemon]');
        let pokemon_name = element.dataset.pokemon;
        let index = this.pokemon_selections.findIndex((i) => i.name == pokemon_name);
        this.pokemon_selections.splice(index, 1);
        element.remove();
    }

    static async _onSubmit(event, target) {
        function getFlavorText(entries) {
            for (const entry of entries) {
                if (entry.language.name == game.i18n.lang) return entry.flavor_text
            }
            return '';
        }

        /**
         * Fetches custom Pokemon data from the custom API
         * @param {string} pokemonName - The name of the Pokemon to fetch
         * @returns {Object|null} - Object with moves and passives arrays, or null if failed
         */
        async function fetchCustomPokemonData(pokemonName) {
            try {
                const normalizedName = pokemonName.toLowerCase().replace(/\s+/g, '-');
                const response = await fetch(CUSTOM_API_URL + normalizedName);
                if (!response.ok) {
                    console.warn(`Custom API: Pokemon ${pokemonName} not found`);
                    return null;
                }
                const data = await response.json();
                
                const moves = [];
                const passives = [];
                
                // Parse moves and passives from the API response
                for (const [key, value] of Object.entries(data)) {
                    if (!value || value === "--") continue;
                    
                    if (key.startsWith("Move")) {
                        moves.push(value);
                    }
                    
                    if (key.startsWith("Passive")) {
                        passives.push(value);
                    }
                }
                
                console.log(`Custom API: Found ${moves.length} moves and ${passives.length} passives for ${pokemonName}`);
                return { moves, passives };
            } catch (error) {
                console.error(`Custom API: Error fetching data for ${pokemonName}:`, error);
                return null;
            }
        }

        /**
         * Creates a move item for the actor based on the move name
         * @param {string} moveName - The name of the move
         * @returns {Object|null} - Move item data or null if not found
         */
        async function createMoveData(moveName) {
            try {
                // Normalize move name for API (e.g., "Quick Attack" -> "quick-attack")
                const normalizedName = moveName.toLowerCase().replace(/\s+/g, '-');
                
                // Check if move exists in Pokedex
                if (!PTA.Pokedex.Moves.includes(normalizedName)) {
                    console.warn(`Move ${moveName} (${normalizedName}) not found in Pokedex`);
                    return null;
                }
                
                // Fetch move data from PokeAPI
                const moveData = await pokeapi.move(normalizedName);
                if (!moveData) {
                    console.warn(`Could not fetch move data for ${moveName}`);
                    return null;
                }
                
                // Parse the move data using existing utility
                const parsedMoveData = utils.parseMoveData(moveData);
                if (!parsedMoveData) {
                    console.warn(`Could not parse move data for ${moveName}`);
                    return null;
                }
                
                // Fetch additional data from custom API (range, frequency, description)
                const customAttackData = await utils.fetchCustomAttackData(moveName);
                console.log(`[v0] createMoveData: customAttackData for ${moveName}:`, customAttackData);
                if (customAttackData) {
                    parsedMoveData.range = customAttackData.range;
                    parsedMoveData.frequency = customAttackData.frequency;
                    console.log(`[v0] createMoveData: Applied range=${parsedMoveData.range}, frequency=${parsedMoveData.frequency}`);
                    // If custom API has a description, use it (it may be more detailed)
                    if (customAttackData.description) {
                        parsedMoveData.description = customAttackData.description;
                    }
                }
                
                return {
                    name: utils.toTitleCase(moveName.replace(/-/g, ' ')),
                    type: 'move',
                    system: parsedMoveData,
                };
            } catch (error) {
                console.error(`Error creating move data for ${moveName}:`, error);
                return null;
            }
        }

        const create_data = [];
        const customDataCache = new Map(); // Cache para armazenar dados da API customizada
        utils.info('PTA.Info.LoadingPleaseWait');
        this.close();
        
        for (const pokemon of this.pokemon_selections) {
            const api_pokemon = await pokeapi.pokemon(pokemon.name);
            const api_speices = await pokeapi.species(api_pokemon.species.name);
            const data = utils.parsePokemonData(api_pokemon);
            data.description = getFlavorText(api_speices.flavor_text_entries);

            if (!data) continue;
            data.hp.value = data.hp.max;
            
            // Fetch custom API data for moves and passives
            const customData = await fetchCustomPokemonData(pokemon.name);
            if (customData) {
                data.passives = customData.passives;
                
                // Fetch descriptions for each passive from the custom API
                const passiveDescriptions = [];
                for (const passiveName of customData.passives) {
                    const passiveData = await utils.fetchCustomPassiveData(passiveName);
                    if (passiveData && passiveData.description) {
                        passiveDescriptions.push(passiveData.description);
                    } else {
                        passiveDescriptions.push(''); // Empty description if not found
                    }
                }
                data.passiveDescriptions = passiveDescriptions;
                
                customDataCache.set(pokemon.name, customData); // Armazena no cache
            }
            
            // Prepare the actor creation data
            const actorData = {
                name: utils.toTitleCase(pokemon.name),
                type: 'pokemon',
                system: data,
                img: pokeapi.Sprite.Official(pokemon.id),
                prototypeToken: {
                    texture: {
                        src: pokeapi.Sprite.Official(pokemon.id)
                    }
                }
            };
            
            create_data.push(actorData);
        }
        
        // Create all actors
        const createdActors = await Actor.create(create_data);
        
        // Convert to array if single actor was created
        const actorsArray = Array.isArray(createdActors) ? createdActors : [createdActors];
        
        // Now import moves for each created actor
        for (let i = 0; i < actorsArray.length; i++) {
            const actor = actorsArray[i];
            const pokemon = this.pokemon_selections[i];
            
            if (!actor) continue;
            
            // Usa o cache para obter os dados customizados
            const customData = customDataCache.get(pokemon.name);
            if (customData && customData.moves.length > 0) {
                const moveItems = [];
                
                for (const moveName of customData.moves) {
                    const moveData = await createMoveData(moveName);
                    if (moveData) {
                        moveItems.push(moveData);
                    }
                }
                
                // Create moves as embedded items in the actor
                if (moveItems.length > 0) {
                    await Item.create(moveItems, { parent: actor });
                    console.log(`Created ${moveItems.length} moves for ${actor.name}`);
                }
            }
        }
        
        utils.info('PTA.Info.ImportComplete');
        this.pokemon_selections = [];
    }

    static async _onSearch(event, target) {
        const content = this.element.querySelector('section.window-content');
        const searchInput = content.querySelector('.search-input');
        const query = searchInput.value.toLowerCase().replace(' ', '-')

        const search_list = [];
        // compile a list of valid pokemon
        for (const i of PTA.Pokedex.Pokemon) if (i.name.startsWith(query)) search_list.push(i);

        const wrapper = this.element.querySelector('.search-results');
        while (wrapper.lastChild) wrapper.removeChild(wrapper.lastChild);

        // goes through and comppiles a list of the pokemon available
        for (const p of search_list) {
            // add the pokemon to the element search results
            let ele = document.createElement('DIV');
            ele.setAttribute('data-action', 'select');
            ele.setAttribute('data-pokemon', p.name);
            ele.setAttribute('style', 'min-width: 100px; min-height: 100px; flex: 0');
            ele.classList.add('pta-grid-item')
            ele.classList.add('flexcol')
            ele.innerHTML = `
                <div style="text-align: center; text-overflow: ellipsis; text-wrap: nowrap; width: 100%; overflow: hidden;">${p.name}</div>
                <img src=${pokeapi.Sprite.Official(p.id)} style="min-width: 100px; min-height: 100px; max-width: 100px; max-height: 100px; border: 0;">
            `
            wrapper.appendChild(ele);
        }
    }

    _onRender(context, options) {
        super._onRender(context, options);

        // Add event listeners for making everything work
        const content = this.element.querySelector('section.window-content');
        if (!content) return;

        const searchData = content.querySelector('form.search-data')
        const searchList = content.querySelector('datalist');
        const searchInput = content.querySelector('.search-input');

        searchData.addEventListener('submit', (event) => {
            if (event.preventDefault) event.preventDefault();
            this.options.actions.search.call(this, event, searchInput);
            return false;
        })

        // add the auto complete search results
        searchInput.addEventListener('input', (event) => {
            const query = searchInput.value.toLowerCase().replace(' ', '-');
            const matches = [];

            // if theres less than 2 characters, dont bother searching
            if (query.length < 1) return;

            // select the right data array to search in
            const sorted = utils.duplicate(PTA.Pokedex.Pokemon).sort((a, b) => a.name.localeCompare(b.name));

            // prepare the search indexing
            let dist = Math.floor(sorted.length - 1) / 2;

            //compare the names and id and get at most five results to populate the field with
            for (const entry of sorted) {
                const { name, id } = entry;
                if (name.startsWith(query) || Number(id) == Number(query)) matches.push(entry);
                if (matches.length >= 5) break;
            }

            // Empty the old list
            while (searchList.lastChild) searchList.removeChild(searchList.lastChild);

            // populate it with new options
            for (const m of matches) {
                const e = document.createElement('option');
                e.value = m.name;
                searchList.appendChild(e);
            }
        });
    }
}
