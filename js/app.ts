
import { createContextMenu, hideContextMenu, showContextMenu } from './menu';
import { CharacterResource } from './types';
import { Character } from './character';

const RESOURCE_PATH = "/assets/models/";

const CHARACTER_RESOURCES: CharacterResource[] = [
    {
        name: "佩佩",
        skeleton: "4058_pepe/build_char_4058_pepe.skel",
        atlas: "4058_pepe/build_char_4058_pepe.atlas",
        texture: "4058_pepe/build_char_4058_pepe.png",
    },
    {
        name: "荒芜拉普兰德",
        skeleton: "1038_whitw2/build_char_1038_whitw2.skel", 
        atlas: "1038_whitw2/build_char_1038_whitw2.atlas",
        texture: "1038_whitw2/build_char_1038_whitw2.png",
    },
];

window.addEventListener('load', () => {
    const character = new Character(
        "arkpets-canvas", 
        showContextMenu,
        CHARACTER_RESOURCES[0],
        RESOURCE_PATH
    );
    console.log("Character initialized", character);
    createContextMenu(CHARACTER_RESOURCES, (char) => {
        character.loadCharacterAssets(char);
    }, () => {
        character.hideCharacter();
    });
});
