import { Channel, GuildChannel, TextChannel, Role, GuildMember, Guild, User, Message, Attachment, Collection, MessageReaction, DMChannel } from "discord.js";
import { Bot } from ".";
import { timeFormat, getDurationDiff, getDayDiff } from "./utils/time";
import dateFormat = require('dateformat');

/**
 * megalogger function for logging channel create and channel delete
 *
 * @export
 * @param {GuildChannel} channel deleted/created channel
 * @param {boolean} created true if it was created, false if it was deleted
 * @returns
 * @memberof megalogger
 */
export async function logChannelToggle(channel: GuildChannel, created: boolean) {
    let megalogDoc = await Bot.database.findMegalogDoc(channel.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(channel.id)) return;
    if (!megalogDoc.channelCreate && created) return;
    if (!megalogDoc.channelDelete && !created) return;

    // send actual log
    let logChannel = channel.guild.channels.get(created ? megalogDoc.toObject().channelCreate : megalogDoc.toObject().channelDelete);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**${channel.type === 'category' ? "Category" : "Channel"} ${created ? 'Created' : 'Deleted'}: ${created ? channel.toString() : '#' + channel.name}**`,
            "color": (created ? Bot.database.settingsDB.cache.embedColors.positive : Bot.database.settingsDB.cache.embedColors.negative),
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "ID: " + channel.id
            },
            "author": {
                "name": channel.guild.name,
                "icon_url": channel.guild.iconURL
            }
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog(created ? 'channelCreate' : 'channelDelete');
}

/**
 * megalogger function for logging a channel update
 * currently logs following actions:
 *  - name change
 *  - topic change
 *  - permissions change
 *
 * @export
 * @param {GuildChannel} oldChannel channel before update
 * @param {GuildChannel} newChannel channel after update
 * @returns
 * @memberof megalogger
 */
export async function logChannelUpdate(oldChannel: GuildChannel, newChannel: GuildChannel) {
    let megalogDoc = await Bot.database.findMegalogDoc(newChannel.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(newChannel.id)) return;
    if (!megalogDoc.channelUpdate) return;

    // sends actual log
    let logChannel = newChannel.guild.channels.get(megalogDoc.toObject().channelUpdate);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    if (oldChannel.name != newChannel.name) { // if name was changed
        await logChannel.send({
            "embed": {
                "description": `**${newChannel.type === 'category' ? "Category" : "Channel"} name changed of ${newChannel.toString()}**`,
                "color": Bot.database.settingsDB.cache.embedColors.default,
                "timestamp": new Date().toISOString(),
                "footer": {
                    "text": "ID: " + newChannel.id
                },
                "author": {
                    "name": newChannel.guild.name,
                    "icon_url": newChannel.guild.iconURL
                },
                "fields": [
                    {
                        "name": "Old",
                        "value": oldChannel.name,
                        "inline": true
                    },
                    {
                        "name": "New",
                        "value": newChannel.name,
                        "inline": true
                    }
                ]
            }
        });
        Bot.mStats.logMessageSend();
    } if (oldChannel instanceof TextChannel && newChannel instanceof TextChannel && oldChannel.topic != newChannel.topic) { // if topic was changed
        await logChannel.send({
            "embed": {
                "description": `**${newChannel.type === 'category' ? "Category" : "Channel"} topic changed of ${newChannel.toString()}**`,
                "color": Bot.database.settingsDB.cache.embedColors.default,
                "timestamp": new Date().toISOString(),
                "footer": {
                    "text": "ID: " + newChannel.id
                },
                "author": {
                    "name": newChannel.guild.name,
                    "icon_url": newChannel.guild.iconURL
                },
                "fields": [
                    {
                        "name": "Old",
                        "value": oldChannel.topic ? oldChannel.topic : '*empty topic*',
                        "inline": true
                    },
                    {
                        "name": "New",
                        "value": newChannel.topic ? newChannel.topic : '*empty topic*',
                        "inline": true
                    }
                ]
            }
        });
        Bot.mStats.logMessageSend();
    }

    // get permission difference between the old and new channel
    let permDiff = oldChannel.permissionOverwrites.filter(x => {
        if (newChannel.permissionOverwrites.find(y => y.allowed.bitfield == x.allowed.bitfield) && newChannel.permissionOverwrites.find(y => y.denied.bitfield == x.denied.bitfield))
            return false;
        return true;
    }).concat(newChannel.permissionOverwrites.filter(x => {
        if (oldChannel.permissionOverwrites.find(y => y.allowed.bitfield == x.allowed.bitfield) && oldChannel.permissionOverwrites.find(y => y.denied.bitfield == x.denied.bitfield))
            return false;
        return true;
    }));
    if (permDiff.size) {
        let embed = { // base embed
            "embed": {
                "description": `**${newChannel.type === 'category' ? "Category" : "Channel"} permissions changed of ${newChannel.toString()}**\n*note:* check [docs](https://discordapp.com/developers/docs/topics/permissions) to see what the numbers mean`,
                "color": Bot.database.settingsDB.cache.embedColors.default,
                "timestamp": new Date().toISOString(),
                "footer": {
                    "text": "ID: " + newChannel.id
                },
                "author": {
                    "name": newChannel.guild.name,
                    "icon_url": newChannel.guild.iconURL
                },
                "fields": []
            }
        };
        for (const permID of permDiff.keys()) { // add a field for changed role or member
            // load both overwrites into variables
            let oldPerm: any = oldChannel.permissionOverwrites.get(permID) || {};
            let newPerm: any = newChannel.permissionOverwrites.get(permID) || {};
            let oldBitfields = {
                allowed: oldPerm.allowed ? oldPerm.allowed.bitfield : 0,
                denied: oldPerm.denied ? oldPerm.denied.bitfield : 0
            };
            let newBitfields = {
                allowed: newPerm.allowed ? newPerm.allowed.bitfield : 0,
                denied: newPerm.denied ? newPerm.denied.bitfield : 0
            };

            // load roles / guildmember for that overwrite
            var role: Role;
            var member: GuildMember;
            if (oldPerm.type == 'role' || newPerm.type == 'role')
                role = newChannel.guild.roles.get(newPerm.id || oldPerm.id);
            if (oldPerm.type == 'member' || newPerm.type == 'member')
                member = await newChannel.guild.fetchMember(newPerm.id || oldPerm.id);

            // make text about what changed
            let value = '';
            if (oldBitfields.allowed !== newBitfields.allowed) {
                value += `Allowed Perms: \`${oldBitfields.allowed}\` to \`${newBitfields.allowed}\`\n`;
            }
            if (oldBitfields.denied !== newBitfields.denied) {
                value += `Denied Perms: \`${oldBitfields.denied}\` to \`${newBitfields.denied}\``;
            }
            if (!value.length) value = 'Overwrite got deleted';

            // add field to embed
            embed.embed.fields.push({
                "name": role ? role.name + ` (ID: ${role.id}):` : member.user.username + ` (ID: ${member.id}):`,
                "value": value
            });
        }
        await logChannel.send(embed);
        Bot.mStats.logMessageSend();
    }
    Bot.mStats.logMegalogLog('channelUpdate');
}

/**
 * megalogger function that logs a ban or unban
 *
 * @export
 * @param {Guild} guild guild in which someone was un-/banned
 * @param {User} user user that got un-/banned
 * @param {boolean} banned true if someone was banned, false if someone was unbanned
 * @returns
 * @memberof megalogger
 */
export async function logBan(guild: Guild, user: User, banned: boolean) {
    let megalogDoc = await Bot.database.findMegalogDoc(guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if ((!megalogDoc.ban && banned) || (!megalogDoc.unban && !banned)) return;

    // send log
    let logChannel = guild.channels.get(banned ? megalogDoc.toObject().ban : megalogDoc.toObject().unban);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `${user.toString()}\n${user.tag}`,
            "color": Bot.database.settingsDB.cache.embedColors[banned ? 'negative' : 'positive'],
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "ID: " + user.id
            },
            "thumbnail": {
                "url": user.displayAvatarURL
            },
            "author": {
                "name": "User " + (banned ? 'Banned' : 'Unbanned'),
                "icon_url": user.displayAvatarURL
            }
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog(banned ? 'ban' : 'unban');
}

/**
 * megalogger function that logs a member join or leave
 *
 * @export
 * @param {GuildMember} member member that joined or left
 * @param {boolean} joined true if member joined, false if member left
 * @returns
 * @memberof megalogger
 */
export async function logMember(member: GuildMember, joined: boolean) {
    let megalogDoc = await Bot.database.findMegalogDoc(member.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if ((!megalogDoc.memberJoin && joined) || (!megalogDoc.memberLeave && !joined)) return;

    // send log
    let logChannel = member.guild.channels.get(joined ? megalogDoc.toObject().memberJoin : megalogDoc.toObject().memberLeave);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    let embed: any = {
        "embed": {
            "description": member.toString() + "\n" + member.user.tag,
            "color": Bot.database.settingsDB.cache.embedColors[joined ? 'positive' : 'negative'],
            "timestamp": joined ? member.joinedAt.toISOString() : new Date().toISOString(),
            "footer": {
                "text": "ID: " + member.id
            },
            "thumbnail": {
                "url": member.user.displayAvatarURL
            },
            "author": {
                "name": "User " + (joined ? 'Joined' : 'Left'),
                "icon_url": member.user.displayAvatarURL
            }
        }
    };
    if (!joined) { // if the member left also add when he joined
        embed.embed.fields = [{
            "name": "Joined At",
            "value": dateFormat(member.joinedAt, timeFormat) + ` (${getDayDiff(member.joinedTimestamp, Date.now())} days ago)`
        }];
    }
    await logChannel.send(embed);
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog(joined ? 'memberJoin' : 'memberLeave');
}

/**
 * megalogger function that logs a nickname change. It checks if the nickname has changed, so you don't have to
 *
 * @export
 * @param {GuildMember} oldMember member before change
 * @param {GuildMember} newMember member after change
 * @returns
 * @memberof megalogger
 */
export async function logNickname(oldMember: GuildMember, newMember: GuildMember) {
    if (oldMember.nickname == newMember.nickname) return;
    let megalogDoc = await Bot.database.findMegalogDoc(newMember.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc.nicknameChange) return;

    // send log
    let logChannel = newMember.guild.channels.get(megalogDoc.nicknameChange);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**${newMember.toString()} nickname changed**`,
            "color": Bot.database.settingsDB.cache.embedColors.default,
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "ID: " + newMember.id
            },
            "author": {
                "name": newMember.user.tag,
                "icon_url": newMember.user.displayAvatarURL
            },
            "fields": [
                {
                    "name": "Before",
                    "value": oldMember.nickname ? oldMember.nickname : '*None*',
                    "inline": true
                },
                {
                    "name": "After",
                    "value": newMember.nickname ? newMember.nickname : '*None*',
                    "inline": true
                }
            ]
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('nicknameChange');
}

/**
 * megalogger function that logs role changes. It checks if the roles have changed, so you don't have to
 *
 * @export
 * @param {GuildMember} oldMember member before change
 * @param {GuildMember} newMember member after change
 * @returns
 * @memberof megalogger
 */
export async function logMemberRoles(oldMember: GuildMember, newMember: GuildMember) {
    // check if member roles even were changed
    let rolesAdded = newMember.roles.filter(x => !oldMember.roles.get(x.id));
    let rolesRemoved = oldMember.roles.filter(x => !newMember.roles.get(x.id));
    if (rolesAdded.size == 0 && rolesRemoved.size == 0) return;

    let megalogDoc = await Bot.database.findMegalogDoc(newMember.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc.memberRolesChange) return;

    // create and send log
    let logChannel = newMember.guild.channels.get(megalogDoc.memberRolesChange);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    let roleAddedString = ''; // which roles were added from the member
    for (const role of rolesAdded.array()) {
        roleAddedString += role.toString();
    }
    let roleRemovedString = ''; // which roles were removed from the member
    for (const role of rolesRemoved.array()) {
        roleRemovedString += role.toString();
    }
    await logChannel.send({
        "embed": {
            "description": `**${newMember.toString()} roles changed**`,
            "color": Bot.database.settingsDB.cache.embedColors.default,
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "ID: " + newMember.id
            },
            "author": {
                "name": newMember.user.tag,
                "icon_url": newMember.user.displayAvatarURL
            },
            "fields": [
                {
                    "name": `Added Roles [${rolesAdded.size}]`,
                    "value": roleAddedString.length == 0 ? '*None*' : roleAddedString,
                    "inline": true
                },
                {
                    "name": `Removed Roles [${rolesRemoved.size}]`,
                    "value": roleRemovedString.length == 0 ? '*None*' : roleRemovedString,
                    "inline": true
                }
            ]
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('memberRolesChange');
}

/**
 * megalogger function that logs a guild name change. Checks if the name was changed, so you don't have to.
 *
 * @export
 * @param {Guild} oldGuild guild before change
 * @param {Guild} newGuild guild after change
 * @returns
 * @memberof megalogger
 */
export async function logGuildName(oldGuild: Guild, newGuild: Guild) {
    if (oldGuild.name == newGuild.name) return;
    let megalogDoc = await Bot.database.findMegalogDoc(newGuild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc.guildNameChange) return;

    // send log
    let logChannel = newGuild.channels.get(megalogDoc.guildNameChange);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**Server name changed**`,
            "color": Bot.database.settingsDB.cache.embedColors.default,
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "ID: " + newGuild.id
            },
            "author": {
                "name": newGuild.name,
                "icon_url": newGuild.iconURL
            },
            "fields": [
                {
                    "name": "Before",
                    "value": oldGuild.name,
                    "inline": true
                },
                {
                    "name": "After",
                    "value": newGuild.name,
                    "inline": true
                }
            ]
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('guildNameChange');
}

/**
 * megalogger function that logs a single message delete
 *
 * @export
 * @param {Message} message message that got deleted
 * @returns
 * @memberof megalogger
 */
export async function logMessageDelete(message: Message) {
    if (message.channel instanceof DMChannel) return;
    let megalogDoc = await Bot.database.findMegalogDoc(message.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(message.channel.id)) return;
    if (!megalogDoc.messageDelete) return;
    if (message.channel.id == megalogDoc.messageDelete) return; // check if deleted message isn't a megalog message
    let logChannel = message.guild.channels.get(megalogDoc.messageDelete);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;

    // shorten message if it's longer then 1024
    let shortened = false;
    let content = message.content;
    if (content.length > 1024) {
        content = content.slice(0, 1020) + '...';
        shortened = true;
    }

    let embed: any = {
        "embed": {
            "description": `**Message from ${message.author.toString()} deleted in ${message.channel.toString()}**`,
            "color": Bot.database.settingsDB.cache.embedColors.negative,
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": `Author: ${message.author.id} | Message: ${message.id}`
            },
            "author": {
                "name": message.author.tag,
                "icon_url": message.author.displayAvatarURL
            },
            "fields": [
                {
                    "name": "Content" + (shortened ? ' (shortened)' : ''),
                    "value": message.content.length > 0 ? content : '*no content*'
                }
            ]
        }
    };
    
    // get attachments from attachment cache
    if (message.attachments.size > 0) {
        let attachments = '';
        for (const attachment of message.attachments)
            attachments += attachment[1].url + '\n';
        embed.embed.fields.push({
            "name": "Attachments",
            "value": attachments
        });
        let cachedAttachments = await getAttachmentCache(message, megalogDoc.toObject().attachmentCache);
        let cachedString: string;
        var cachedArray: string[] = [];
        if (cachedAttachments && cachedAttachments.size > 0) {
            cachedString = 'Cached attachments are also attachments of this message\n'
            for (const attachment of cachedAttachments) {
                cachedString += attachment[1].url + '\n';
                cachedArray.push(attachment[1].url);
            }
        } else {
            cachedString = 'Couldn\'t find and cached attachments. Either the `attachmentCache` channel isn\'t defined in the megalogger or the message wasn\'t cached.'
        }
        embed.embed.fields.push({
            "name": "Cached Attachments",
            "value": cachedString
        });
        embed.files = cachedArray;
    }

    await logChannel.send(embed);
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('messageDelete');
}

/**
 * megalogger function that logs a bulk deletion of messages
 *
 * @export
 * @param {Collection<string, Message>} messages all messages deleted
 * @returns
 * @memberof megalogger
 */
export async function logMessageBulkDelete(messages: Collection<string, Message>) {
    if (messages.first().channel instanceof DMChannel) return;
    let megalogDoc = await Bot.database.findMegalogDoc(messages.first().guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(messages.first().channel.id)) return;
    if (!megalogDoc.messageDelete) return;
    if (messages.first().channel.id == megalogDoc.messageDelete) return; // check if deleted messages aren't megalog messages

    // create and send log
    let logChannel = messages.first().guild.channels.get(megalogDoc.messageDelete);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;

    // create attachment file with  deleted messages, needs to be with a certain format so https://txt.discord.website/ can show it correctly
    //@ts-ignore
    let humanLog = `**Deleted Messages from #${messages.first().channel.name} (${messages.first().channel.id}) in ${messages.first().guild.name} (${messages.first().guild.id})**`;
    for (const message of messages.array().reverse()) {
        humanLog += `\r\n\r\n[${dateFormat(message.createdAt, timeFormat)}] ${message.author.tag} (${message.id})`;
        humanLog += ' : ' + message.content;
        if (message.attachments.size) {
            humanLog += '\n*Attachments:*';
            let cachedAttachments = await getAttachmentCache(message, megalogDoc.toObject().attachmentCache);
            if (cachedAttachments || cachedAttachments.size) {
                for (const attachment of cachedAttachments.array()) {
                    humanLog += '\n' + attachment.url;
                }
            } else {
                humanLog += '\n*No cache found*'
            }
        }
    }
    let attachment = new Attachment(Buffer.from(humanLog, 'utf-8'), 'DeletedMessages.txt'); // send attachment

    // send actual log with the attachment as input for https://txt.discord.website/
    //@ts-ignore
    let logMessage: Message = await logChannel.send(attachment);
    logMessage.edit({
        "embed": {
            "description": `**Bulk deleted messages in ${messages.first().channel.toString()}**`,
            "color": Bot.database.settingsDB.cache.embedColors.negative,
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "Channel: " + messages.first().channel.id
            },
            "author": {
                //@ts-ignore
                "name": messages.first().channel.name,
                "icon_url": messages.first().guild.iconURL
            },
            "fields": [
                {
                    "name": "Message Count",
                    "value": messages.size,
                    "inline": true
                },
                {
                    "name": "Deleted Messages",
                    "value": `[view](https://txt.discord.website/?txt=${logChannel.id}/${logMessage.attachments.first().id}/DeletedMessages)`,
                    "inline": true
                }
            ]
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('messageDelete');
}

/**
 * returns cached attachments if they were found
 *
 * @param {Message} message message of which to find cached attachments
 * @param {string} cacheChannelID id of cache channel
 * @param {number} [timerange=3000] in what timerange it should search the cache
 * @returns
 * @memberof megalogger
 */
async function getAttachmentCache(message: Message, cacheChannelID: string, timerange = 3000) {
    let cacheChannel = message.guild.channels.get(cacheChannelID);
    if (!cacheChannel || !(cacheChannel instanceof TextChannel)) return;
    var cache = await cacheChannel.fetchMessages({ limit: 20, around: message.id }); // loads 20 messages that were send around that time
    var cacheMessage = cache.find(x => x.content.includes(`BulletBotCacheTagThing: ${message.url}`)); // get attachment cache with the specific id
    if (!cacheMessage || !cacheMessage.attachments.size) return;
    return cacheMessage.attachments;
}

/**
 * megalogger function that caches every attachment from a message in a channel
 *
 * @export
 * @param {Message} message message of which to cache attachments
 * @returns
 * @memberof megalogger
 */
export async function cacheAttachment(message: Message) {
    if (message.channel instanceof DMChannel) return;
    if (message.attachments.size == 0) return; // check if message has even attachments
    let megalogDoc = await Bot.database.findMegalogDoc(message.guild.id);
    // check megalog settings if this should get cached
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(message.channel.id)) return;
    if (!megalogDoc.attachmentCache) return;

    // send attachment cache
    let logChannel = message.guild.channels.get(megalogDoc.attachmentCache);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    let attachments: string[] = [];
    for (const attachment of message.attachments.array()) {
        attachments.push(attachment.url);
    }
    try {
        await logChannel.send(`from ${message.author.tag} (${message.author.id}) in ${message.channel} (${message.channel.id})\nBulletBotCacheTagThing: ${message.url}`, {
            files: attachments
        });
    } catch (e) {
        // attachment probably too big
        await logChannel.send(`from ${message.author.tag} (${message.author.id}) in ${message.channel} (${message.channel.id})\n${message.url}\nAttachments too large to send`);
    }
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('attachmentCache');
}

/**
 * megalogger function that logs a message edit. Checks if message was edited, so you don't have to check
 *
 * @export
 * @param {Message} oldMessage message before edit
 * @param {Message} newMessage message after edit
 * @returns
 * @memberof megalogger
 */
export async function logMessageEdit(oldMessage: Message, newMessage: Message) {
    if (newMessage.channel instanceof DMChannel) return;
    if (oldMessage.content == newMessage.content) return; // check if content even changed

    let megalogDoc = await Bot.database.findMegalogDoc(newMessage.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(newMessage.channel.id)) return;
    if (!megalogDoc.messageEdit) return;
    if (megalogDoc.messageDelete == newMessage.channel.id && newMessage.author.id == Bot.client.user.id) return; // check if it isn't a megalog that was edited

    // create and send log
    let logChannel = newMessage.guild.channels.get(megalogDoc.messageEdit);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;

    // shorten both messages when the content is larger then 1024 chars
    let oldShortened = false;
    let oldContent = oldMessage.content;
    if (oldContent.length > 1024) {
        oldContent = oldContent.slice(0, 1020) + '...';
        oldShortened = true;
    }
    let newShortened = false;
    let newContent = newMessage.content;
    if (newContent.length > 1024) {
        newContent = newContent.slice(0, 1020) + '...';
        newShortened = true;
    }

    // send log
    await logChannel.send({
        "embed": {
            "description": `**Message of ${newMessage.author.toString()} edited in ${newMessage.channel.toString()}** [Jump to Message](${newMessage.url})`,
            "color": Bot.database.settingsDB.cache.embedColors.default,
            "timestamp": newMessage.editedAt.toISOString(),
            "footer": {
                "text": `Author: ${newMessage.author.id} | Message: ${newMessage.id}`
            },
            "author": {
                "name": newMessage.author.tag,
                "icon_url": newMessage.author.displayAvatarURL
            },
            "fields": [
                {
                    "name": "Before" + (oldShortened ? ' (shortened)' : ''),
                    "value": oldMessage.content.length > 0 ? oldContent : '*empty message*'
                },
                {
                    "name": "After" + (newShortened ? ' (shortened)' : ''),
                    "value": newMessage.content.length > 0 ? newContent : '*empty message*'
                }
            ]
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('messageEdit');

}

/**
 * megalogger function that logs a react/unreact
 *
 * @export
 * @param {MessageReaction} reaction reactions of message
 * @param {User} user user that un-/reacted
 * @param {boolean} reacted true if user reacted, false if user unreacted
 * @returns
 * @memberof megalogger
 */
export async function logReactionToggle(reaction: MessageReaction, user: User, reacted: boolean) {
    if (reaction.message.channel instanceof DMChannel) return;
    let megalogDoc = await Bot.database.findMegalogDoc(reaction.message.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(reaction.message.channel.id)) return;
    if ((reacted && !megalogDoc.reactionAdd) || (!reacted && !megalogDoc.reactionRemove)) return;

    // send log
    let logChannel = reaction.message.guild.channels.get(reacted ? megalogDoc.reactionAdd : megalogDoc.reactionRemove);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**${user.toString()} ${!reacted ? 'un' : ''}reacted with ${reaction.emoji.toString()} to [this message](${reaction.message.url})${!reacted ? ' (or reaction got removed)' : ''}** `,
            "color": Bot.database.settingsDB.cache.embedColors[reacted ? 'positive' : 'negative'],
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": `User: ${user.id} | Message: ${reaction.message.id} `
            },
            "author": {
                "name": user.tag,
                "icon_url": user.displayAvatarURL
            },
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog(reacted ? 'reactionAdd' : 'reactionRemove');
}

/**
 * megalogger function that logs a reaction reset on a message
 *
 * @export
 * @param {Message} message message that got reset
 * @returns
 * @memberof megalogger
 */
export async function logReactionRemoveAll(message: Message) {
    if (message.channel instanceof DMChannel) return;
    let megalogDoc = await Bot.database.findMegalogDoc(message.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (megalogDoc.ignoreChannels && megalogDoc.ignoreChannels.includes(message.channel.id)) return;
    if (!megalogDoc.reactionRemove) return;

    // send log
    let logChannel = message.guild.channels.get(megalogDoc.reactionRemove);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**All reactions were removed from a message of ${message.author.toString()} in ${message.channel.toString()}** [Jump to Message](${message.url})`,
            "color": Bot.database.settingsDB.cache.embedColors.negative,
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": `Author: ${message.author.id} | Message: ${message.id}`
            },
            "author": {
                "name": message.author.tag,
                "icon_url": message.author.displayAvatarURL
            }
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('reactionRemove');
}

/**
 * megalogger function that logs a role creation/deletion
 *
 * @export
 * @param {Role} role role that got created/deleted
 * @param {boolean} created true if role got created, false if role got deleted
 * @returns
 * @memberof megalogger
 */
export async function logRoleToggle(role: Role, created: boolean) {
    let megalogDoc = await Bot.database.findMegalogDoc(role.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if ((created && !megalogDoc.roleCreate) || (!created && !megalogDoc.roleDelete)) return;

    // send log
    let logChannel = role.guild.channels.get(created ? megalogDoc.roleCreate : megalogDoc.roleDelete);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    try {
        await logChannel.send({
            "embed": {
                "description": `**Role ${role} (${role.name}) was ${created ? 'created' : 'deleted'}**`,
                "color": Bot.database.settingsDB.cache.embedColors[created ? 'positive' : 'negative'],
                "timestamp": created ? role.createdAt.toISOString() : new Date().toISOString(),
                "footer": {
                    "text": "ID: " + role.id
                },
                "author": {
                    "name": role.guild.name,
                    "icon_url": role.guild.iconURL
                }
            }
        });
    } catch (e) {
        return; // very likely just left the server and the bot specific role got deleted
    }
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog(created ? 'roleCreate' : 'roleDelete');
}

/**
 * megalogger function that logs a role name/color/permission change
 *
 * @export
 * @param {Role} oldRole role before change
 * @param {Role} newRole role after change
 * @returns
 * @memberof megalogger
 */
export async function logRoleUpdate(oldRole: Role, newRole: Role) {
    if ((oldRole.name == newRole.name) && (oldRole.color == newRole.color) && (oldRole.permissions == newRole.permissions)) return;
    let megalogDoc = await Bot.database.findMegalogDoc(newRole.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc.roleUpdate) return;

    // send logs
    let logChannel = newRole.guild.channels.get(megalogDoc.roleUpdate);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    let date = new Date();
    if (oldRole.name != newRole.name) { // if name was changed
        await logChannel.send({
            "embed": {
                "description": `**Role name of ${newRole} (${newRole.name}) changed**`,
                "color": Bot.database.settingsDB.cache.embedColors.default,
                "timestamp": date.toISOString(),
                "footer": {
                    "text": "ID: " + newRole.id
                },
                "author": {
                    "name": newRole.guild.name,
                    "icon_url": newRole.guild.iconURL
                },
                "fields": [
                    {
                        "name": "Before",
                        "value": oldRole.name
                    },
                    {
                        "name": "After",
                        "value": newRole.name
                    }
                ]
            }
        });
        Bot.mStats.logMessageSend();
    }
    if (oldRole.color != newRole.color) { // if color was changed
        await logChannel.send({
            "embed": {
                "description": `**Role color of ${newRole} (${newRole.name}) changed**`,
                "color": Bot.database.settingsDB.cache.embedColors.default,
                "timestamp": date.toISOString(),
                "footer": {
                    "text": "ID: " + newRole.id
                },
                "author": {
                    "name": newRole.guild.name,
                    "icon_url": newRole.guild.iconURL
                },
                "fields": [
                    {
                        "name": "Before",
                        "value": `${oldRole.color} ([${oldRole.hexColor}](https://www.color-hex.com/color/${oldRole.hexColor.slice(1)}))`
                    },
                    {
                        "name": "After",
                        "value": `${newRole.color} ([${newRole.hexColor}](https://www.color-hex.com/color/${newRole.hexColor.slice(1)}))`
                    }
                ]
            }
        });
        Bot.mStats.logMessageSend();
    }
    if (oldRole.permissions != newRole.permissions) { // if permissions were changed
        await logChannel.send({
            "embed": {
                "description": `**Role permissions of ${newRole} (${newRole.name}) changed**\n[What those numbers mean](https://discordapp.com/developers/docs/topics/permissions)`,
                "color": Bot.database.settingsDB.cache.embedColors.default,
                "timestamp": date.toISOString(),
                "footer": {
                    "text": "ID: " + newRole.id
                },
                "author": {
                    "name": newRole.guild.name,
                    "icon_url": newRole.guild.iconURL
                },
                "fields": [
                    {
                        "name": "Before",
                        "value": oldRole.permissions
                    },
                    {
                        "name": "After",
                        "value": newRole.permissions
                    }
                ]
            }
        });
        Bot.mStats.logMessageSend();
    }
    Bot.mStats.logMegalogLog('roleUpdate');
}

/**
 * megalogger function that logs a voice transfer (leave join voice channel)
 *
 * @export
 * @param {GuildMember} oldMember member before transfer
 * @param {GuildMember} newMember member after transfer
 * @returns
 * @memberof megalogger
 */
export async function logVoiceTransfer(oldMember: GuildMember, newMember: GuildMember) {
    if (oldMember.voiceChannelID == newMember.voiceChannelID) return;
    let megalogDoc = await Bot.database.findMegalogDoc(newMember.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc.voiceTransfer) return;

    // send log
    let logChannel = newMember.guild.channels.get(megalogDoc.voiceTransfer);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**${newMember.toString()} moved from voice channels ${oldMember.voiceChannel ? oldMember.voiceChannel : 'None'} to ${newMember.voiceChannel ? newMember.voiceChannel : 'None'}**`,
            "color": Bot.database.settingsDB.cache.embedColors[!oldMember.voiceChannelID ? 'positive' : (!newMember.voiceChannelID ? 'negative' : 'default')],
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "User: " + newMember.id
            },
            "author": {
                "name": newMember.user.username,
                "icon_url": newMember.user.displayAvatarURL
            }
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('voiceTransfer');
}

/**
 * megalogger function that logs a un-/mute in a voice channel
 *
 * @export
 * @param {GuildMember} oldMember member before un-/mute
 * @param {GuildMember} newMember member after un-/mute
 * @returns
 * @memberof megalogger
 */
export async function logVoiceMute(oldMember: GuildMember, newMember: GuildMember) {
    if (oldMember.mute == newMember.mute) return; // check if member mute state changed
    let megalogDoc = await Bot.database.findMegalogDoc(newMember.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc.voiceMute) return;

    // send log
    let logChannel = newMember.guild.channels.get(megalogDoc.voiceMute);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**${newMember} was voice ${newMember.mute ? '' : 'un'}muted in ${newMember.voiceChannel}**`,
            "color": Bot.database.settingsDB.cache.embedColors[newMember.mute ? 'negative' : 'positive'],
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "User: " + newMember.id
            },
            "author": {
                "name": newMember.user.username,
                "icon_url": newMember.user.displayAvatarURL
            }
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('voiceMute');
}

/**
 * megalogger function that logs a un-/deafen in a voice channel
 *
 * @export
 * @param {GuildMember} oldMember member before un-/deafen
 * @param {GuildMember} newMember member after un-/deafen
 * @returns
 * @memberof megalogger
 */
export async function logVoiceDeaf(oldMember: GuildMember, newMember: GuildMember) {
    if (oldMember.deaf == newMember.deaf) return; // changed if member deaf state changed
    let megalogDoc = await Bot.database.findMegalogDoc(newMember.guild.id);
    // check megalog settings if this should get logged
    if (!megalogDoc) return;
    if (!megalogDoc.voiceDeaf) return;

    // send log
    let logChannel = newMember.guild.channels.get(megalogDoc.voiceDeaf);
    if (!logChannel || !(logChannel instanceof TextChannel)) return;
    await logChannel.send({
        "embed": {
            "description": `**${newMember} was voice ${newMember.deaf ? '' : 'un'}deafed in ${newMember.voiceChannel}**`,
            "color": Bot.database.settingsDB.cache.embedColors[newMember.deaf ? 'negative' : 'positive'],
            "timestamp": new Date().toISOString(),
            "footer": {
                "text": "User: " + newMember.id
            },
            "author": {
                "name": newMember.user.username,
                "icon_url": newMember.user.displayAvatarURL
            }
        }
    });
    Bot.mStats.logMessageSend();
    Bot.mStats.logMegalogLog('voiceDeaf');
}
