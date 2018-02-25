//////////////////////////////////////////////////
// Server for duel zone
//////////////////////////////////////////////////

import _ = require('lodash');

import Scene = require('../kaze/scene');
import FloorTileGrid = require('../kaze/floor-tile-grid');
import GameScene = require('../kaze/game-scene');
import GsNetwork = require('../kaze/game-scene-network');
import Shared = require('./index-server');
import KazeServer = require('../kaze/server');
import Calcs = require('../kaze/calcs');
import MapFile = require('../kaze/map-file');

import Vec2d = Calcs.Vec2d;
import VirtualFloorTileGrid = FloorTileGrid.VirtualFloorTileGrid;
import IHasDuelZoneCharacterData = Shared.IHasDuelZoneCharacterData;
import DuelZoneCharacterData = Shared.DuelZoneCharacterData;

// Don't make explosions client side
Shared.rocketWeapon.onBulletHit = Shared.boom.onBulletHit;

class DuelZoneCharacter extends GameScene.Character implements IHasDuelZoneCharacterData {
    data: DuelZoneCharacterData;
    constructor(name: string, width: number, height: number) {
        super(width, height);
        this.name = name;
        this.weapons = [Shared.burstWeapon, Shared.autoWeapon, Shared.rocketWeapon, Shared.sniperWeapon];
        this.data = new DuelZoneCharacterData(name);
    }
}

const parsedMapJson = require('../../../assets/hank.json') as MapFile.MapFile;
const parsedDsMapJson = require('../../../assets/dropship.json') as MapFile.MapFile;

const grid = FloorTileGrid.FloorTileGrid.fromMapFileBarrierOnly(parsedMapJson);
const dsGrid = FloorTileGrid.FloorTileGrid.fromMapFileBarrierOnly(parsedDsMapJson);

//////////////////////////////////////////////////

// TODO Easier
const inverted = MapFile.invertMarkersObject(parsedDsMapJson.mapContent.markers);
const spawnBlockCoords = MapFile.parseMarkerCoord(inverted['spawn']);
spawnBlockCoords.x += 3;
spawnBlockCoords.y += 0;
const spawnCoords = Vec2d.mult(spawnBlockCoords, Shared.MapBlockLength);

const addCharacter = (name: string): DuelZoneCharacter => {
    const character = new DuelZoneCharacter(name, Shared.CharacterWidth, Shared.CharacterWidth);
    scene.controller.grid.registerRect(character);
    scene.controller.grid.editRect(character, spawnCoords.x, spawnCoords.y);
    return character;
};
const deleteCharacter = (character: DuelZoneCharacter): void => {
    scene.controller.grid.unregisterRect(character.id);
};
const hookOnUpdate = (
    onUpdate: (diff: number, c: GameScene.Controller) => void
): void => {
    sceneData.onUpdate = onUpdate;
};
const onClose = (result: KazeServer.IOnCloseResult): void => {};
const onConnect = (result: KazeServer.IOnConnectResult): void => {
    const characters = Array.from(server.characterMap.values());
    result.ws.send(JSON.stringify({
        type: '@kdInit',
        entries: characters.map((_character) => {
            const character = _character as DuelZoneCharacter;
            return [character.id, character.data.kills, character.data.deaths];
        })
    }));
};
const server = KazeServer.Server.getInstance({
    port: 1337,
    viewportWidth: Shared.ViewportWidth,
    viewportHeight: Shared.ViewportHeight,
    onConnect,
    onClose,
    hookOnUpdate,
    addCharacter,
    deleteCharacter
});

//////////////////////////////////////////////////

const respawnIfDead = (
    controller: GameScene.Controller,
    character: DuelZoneCharacter,
    owner: DuelZoneCharacter): void => {

    if (character.hp < 0) {
        owner.data.kills++;
        character.data.deaths++;

        character.hp = character.maxHp;
        owner.hp = owner.maxHp;

        controller.grid.editRect(
            character,
            spawnCoords.x - 80 + Math.random() * 160,
            spawnCoords.y - 80 + Math.random() * 160
        );

        server.broadcast(JSON.stringify({
            type: '@updateKd',
            id: character.id,
            kills: character.data.kills,
            deaths: character.data.deaths
        }));

        server.broadcast(JSON.stringify({
            type: '@updateKd',
            id: owner.id,
            kills: owner.data.kills,
            deaths: owner.data.deaths
        }));
    }
};

const getBarr = FloorTileGrid.makeGetBarrierTypeRegion(grid);
const getBarrDs = FloorTileGrid.makeGetBarrierTypePattern(dsGrid);

const bigGrid = FloorTileGrid.combine([
    [VirtualFloorTileGrid.getEmpty(3, 3), new VirtualFloorTileGrid(dsGrid.blockWidth * 2, dsGrid.blockHeight * 2, getBarrDs)],
    [VirtualFloorTileGrid.getEmpty(3, 3)],
    [new VirtualFloorTileGrid(grid.blockWidth, grid.blockHeight, getBarr)]
]);

const sceneData = Shared.makeSceneData();
sceneData.getBarrierType = FloorTileGrid.makeGetBarrierTypeRegion(bigGrid);

sceneData.onCharacterBulletHit = (controller, _character, bullet) => {
    const character = _character as DuelZoneCharacter;
    character.hp -= bullet.weapon.damage;
    respawnIfDead(controller, character, bullet.owner as DuelZoneCharacter);
    return true;
};

sceneData.onCharacterExplosionHit = (controller, _character, explosion) => {
    const character = _character as DuelZoneCharacter;
    character.hp -= explosion.explosionType.damage;
    respawnIfDead(controller, character, explosion.owner as DuelZoneCharacter);
    return true;
};

const scene = GameScene.createGameScene(sceneData);
GameScene.importTeleporters([
    new GameScene.TeleImportMapSpec(parsedMapJson, 0, 23),
    new GameScene.TeleImportMapSpec(parsedDsMapJson, 3, 0)
] , [
    new GameScene.TeleporterSpec('outside', 'inside'),
    new GameScene.TeleporterSpec('exit', 'hank', new Vec2d(400, 50))
], scene.controller);

//////////////////////////////////////////////////

Scene.playScene({
    fps: 60,
    canvas: new Scene.CanvasSizeSubstitute(Shared.ViewportWidth, Shared.ViewportHeight),
    scene
});
server.start();
