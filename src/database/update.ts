import mongoose = require('mongoose');
import { cluster } from '../bot-config.json';
import { guildSchema, staffSchema, commandsSchema, megalogSchema, guildDoc, staffDoc, commandsDoc, megalogDoc, megalogObject } from './schemas.js';

// prefix
export interface prefixObject {
    guild: string;
    prefix: string;
}
export interface prefixDoc extends mongoose.Document, prefixObject { }
export const prefixSchema = new mongoose.Schema({
    guild: String,
    prefix: String
});

export async function updateDatabaseAfter1_2_8() {
    console.info('Database changes for this update will be applied.');

    let mainCon = await mongoose.createConnection(cluster.url + '/main' + cluster.suffix, { useNewUrlParser: true });

    let guildCollection: mongoose.Model<guildDoc> = mainCon.model('guild', guildSchema, 'guilds');

    let prefixCollection: mongoose.Model<prefixDoc> = mainCon.model('prefix', prefixSchema, 'prefix');
    let staffCollection: mongoose.Model<staffDoc> = mainCon.model('staff', staffSchema, 'staff');
    let commandsCollection: mongoose.Model<commandsDoc> = mainCon.model('commands', commandsSchema, 'commands');
    let megalogCollection: mongoose.Model<megalogDoc> = mainCon.model('megalogSettings', megalogSchema, 'megalogs');

    let guildDocs = await guildCollection.find().exec();
    for (const guildDoc of guildDocs) {
        guildDoc.id = guildDoc.guild;
        delete guildDoc.guild;

        let prefixDoc = await prefixCollection.findOne({ guild: guildDoc.id }).exec();
        if (prefixDoc) guildDoc.prefix = prefixDoc.prefix;

        let staffDoc = await staffCollection.findOne({ guild: guildDoc.id }).exec();
        if (staffDoc)
            guildDoc.ranks = {
                admins: [...staffDoc.admins.users, ...staffDoc.admins.roles],
                mods: [...staffDoc.mods.users, ...staffDoc.mods.roles],
                immune: [...staffDoc.immune.users, ...staffDoc.immune.roles]
            };

        let commandsDoc = await commandsCollection.findOne({ guild: guildDoc.id }).exec();
        if (commandsDoc)
            guildDoc.commandSettings = commandsDoc.commands;

        let megalogDoc = await megalogCollection.findOne({ guild: guildDoc.id }).exec();
        if (megalogDoc) {
            let megalogObj: megalogObject = megalogDoc.toObject({ versionKey: false });
            delete megalogObj.guild;
            guildDoc.megalog = megalogObj;
        }
        guildDoc.save();
    }

    for (const name of ['prefix', 'staff', 'commands', 'megalogs'])
        try {
            await mainCon.dropCollection(name);
        } catch{ }
    console.info('Database was successfully updated');
}