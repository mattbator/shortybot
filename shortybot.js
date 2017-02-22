/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a sample Slack bot built with Botkit.

This bot demonstrates many of the core features of Botkit:

* Connect to Slack using the real time API
* Receive messages based on "spoken" patterns
* Reply to messages
* Use the conversation system to ask questions
* Use the built in storage system to store and retrieve information
  for a user.

# RUN THE BOT:

  Get a Bot token from Slack:

    -> http://my.slack.com/services/new/bot

  Run your bot from the command line:

    token=<MY TOKEN> node slack_bot.js

# USE THE BOT:

  Find your bot inside Slack to send it a direct message.

  Say: "Hello"

  The bot will reply "Hello!"

  Say: "who are you?"

  The bot will tell you its name, where it is running, and for how long.

  Say: "Call me <nickname>"

  Tell the bot your nickname. Now you are friends.

  Say: "who am I?"

  The bot will tell you your nickname, if it knows one for you.

  Say: "shutdown"

  The bot will ask if you are sure, and then shut itself down.

  Make sure to invite your bot into other channels using /invite @<my bot>!

# EXTEND THE BOT:

  Botkit has many features for building cool and useful bots!

  Read all about it here:

    -> http://howdy.ai/botkit

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

require('dotenv').config({path:__dirname + '/.env'});

var Botkit = require('./lib/Botkit.js');
var request = require('request')

var controller = Botkit.slackbot({
    debug: false,
});

var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
}).startRTM();

controller.hears(['hello','hi','hey','what\'s up','whaddup'], 'direct_message,direct_mention,mention', function(bot, message) {

    bot.api.reactions.add({
        timestamp: message.ts,
        channel: message.channel,
        name: 'robot_face',
    }, function(err, res) {
        if (err) {
            bot.botkit.log('Failed to add emoji reaction :(', err);
        }
    });


    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Hello ' + user.name + '!!');
        } else {
            bot.reply(message, 'Long time, no talk!');
        }
    });
});

/*controller.hears(['call me (.*)', 'my name is (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var name = message.match[1];
    controller.storage.users.get(message.user, function(err, user) {
        if (!user) {
            user = {
                id: message.user,
            };
        }
        user.name = name;
        controller.storage.users.save(user, function(err, id) {
            bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
        });
    });
});

controller.hears(['what is my name', 'who am i'], 'direct_message,direct_mention,mention', function(bot, message) {

    controller.storage.users.get(message.user, function(err, user) {
        if (user && user.name) {
            bot.reply(message, 'Your name is ' + user.name);
        } else {
            bot.startConversation(message, function(err, convo) {
                if (!err) {
                    convo.say('I do not know your name yet!');
                    convo.ask('What should I call you?', function(response, convo) {
                        convo.ask('You want me to call you `' + response.text + '`?', [
                            {
                                pattern: 'yes',
                                callback: function(response, convo) {
                                    // since no further messages are queued after this,
                                    // the conversation will end naturally with status == 'completed'
                                    convo.next();
                                }
                            },
                            {
                                pattern: 'no',
                                callback: function(response, convo) {
                                    // stop the conversation. this will cause it to end with status == 'stopped'
                                    convo.stop();
                                }
                            },
                            {
                                default: true,
                                callback: function(response, convo) {
                                    convo.repeat();
                                    convo.next();
                                }
                            }
                        ]);

                        convo.next();

                    }, {'key': 'nickname'}); // store the results in a field called nickname

                    convo.on('end', function(convo) {
                        if (convo.status == 'completed') {
                            bot.reply(message, 'OK! I will update my dossier...');

                            controller.storage.users.get(message.user, function(err, user) {
                                if (!user) {
                                    user = {
                                        id: message.user,
                                    };
                                }
                                user.name = convo.extractResponse('nickname');
                                controller.storage.users.save(user, function(err, id) {
                                    bot.reply(message, 'Got it. I will call you ' + user.name + ' from now on.');
                                });
                            });



                        } else {
                            // this happens if the conversation ended prematurely for some reason
                            bot.reply(message, 'OK, nevermind!');
                        }
                    });
                }
            });
        }
    });
});


controller.hears(['shutdown'], 'direct_message,direct_mention,mention', function(bot, message) {

    bot.startConversation(message, function(err, convo) {

        convo.ask('Are you sure you want me to shutdown?', [
            {
                pattern: bot.utterances.yes,
                callback: function(response, convo) {
                    convo.say('Bye!');
                    convo.next();
                    setTimeout(function() {
                        process.exit();
                    }, 3000);
                }
            },
        {
            pattern: bot.utterances.no,
            default: true,
            callback: function(response, convo) {
                convo.say('*Phew!*');
                convo.next();
            }
        }
        ]);
    });
});*/

controller.hears(['shorten (.*) (.*)','shorten (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var oldLink = message.match[1];
    var tag = message.match[2];
    
    //Parse out hyperlink text from Slack message
    oldLink = oldLink.replace('<','');
    oldLink = oldLink.replace('>','');
    oldLink = oldLink.split('|');
    oldLink = JSON.stringify(oldLink);
    var oldLinkObj = JSON.parse(oldLink);
    
    //Add URL and slashtag validation
    
    request({
        uri: 'https://api.rebrandly.com/v1/links',
        method: "POST",
        body: JSON.stringify({
          destination: oldLinkObj[0]
           , slashtag: tag
           , description: oldLinkObj[0]
           , domain: {
             id:process.env.DOMAIN_ID
           }
        }),
        headers: {
          'Content-Type': 'application/json',
          'apikey':process.env.REBRANDLY_API
        }
      }, function(err, response, body) {
           if (!err && response.statusCode == 200) {
             var newLink = JSON.parse(body);
             bot.reply(message,':tada: It worked! Your new short URL is: http://'+newLink.shortUrl+'\n\n \
             @shorty clicks '+newLink.id+' - _Tells you how many times your shortened link has been clicked_\n \
             @shorty delete '+newLink.id+' - _Deletes your shortened link_');
           } else {
             bot.reply(message,'*Beep boop!* Uh-oh, friend! Looks like there\'s an error that @matt hasn\'t sorted out yet! Could be your link already exists or your slashtag contains invalid characters like Jon Kohler emojis!');
           }
      })
});

controller.hears(['delete (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var linkId = message.match[1];
   
    //Add validation
    
    request({
        uri: 'https://api.rebrandly.com/v1/links/'+linkId,
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'apikey':process.env.REBRANDLY_API
        }
      }, function(err, response, body) {
           if (!err && response.statusCode == 200) {
             var link = JSON.parse(body);
             
             bot.startConversation(message, function(err, convo) {
               convo.ask('Are you *sure* you want to delete http://'+link.shortUrl+', which redirects to '+link.destination+'?', [
               {
                pattern: bot.utterances.yes,
                callback: function(response, convo) {
                	request({
        				uri: 'https://api.rebrandly.com/v1/links/'+linkId,
        				method: 'DELETE',
        				headers: {
          					'Content-Type': 'application/json',
          					'apikey':process.env.REBRANDLY_API
        				}
      					}, function(err, response, body) {
           					if (!err && response.statusCode == 200) {
             					var link = JSON.parse(body);
             					convo.say(':skull_and_crossbones: http://'+link.shortUrl+' has been deleted. I hope you\'re happy.');
                    			convo.next();
           					} else {
             					convo.say('*Beep boop!* Uh-oh, friend! Looks like that link ID doesn\'t exist!');
           						convo.next();
           }
      })
                }
                },
                {
                pattern: bot.utterances.no,
                default: true,
                callback: function(response, convo) {
                convo.say('Beep boop! That was a close one!');
                convo.next();
            }
        }
        ]);
    });
             
           } else {
             bot.reply(message,'*Beep boop!* Uh-oh, friend! Looks like that link ID doesn\'t exist!');
           }
      })
});

controller.hears(['info (.*)','clicks (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var linkId = message.match[1];
    
    //Add validation
    
    request({
        uri: 'https://api.rebrandly.com/v1/links/'+linkId,
        method: "GET",
        headers: {
          'Content-Type': 'application/json',
          'apikey':process.env.REBRANDLY_API
        }
      }, function(err, response, body) {
           if (!err && response.statusCode == 200) {
             var link = JSON.parse(body);
             var created = new Date(link.createdAt)
             bot.reply(message,'http://'+link.shortUrl+' has been clicked '+link.clicks+' times since it was created on '+created);
           } else {
             bot.reply(message,'*Beep boop!* Uh-oh, friend! Looks like that link ID doesn\'t exist!');
           }
      })
});

controller.hears(['help'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,':robot_face:*Beep boop! I\'m a bot that helps you to shorten links!*\n\n \
       I hope to learn lots of totally sweet tricks one day, in the meantime you should find these commands useful: \n\n \
       1. @shorty shorten <Ugly Long URL> - _Creates a ntnx.tips URL with a short, random Slashtag e.g. ntnx.tips/rngg_ \n \
       2. @shorty shorten <Ugly Long URL> <Slashtag> - _Creates a ntnx.tips URL with a sweet, custom Slashtag e.g. ntnx.tips/MattRocks_ \n \
       3. @shorty delete <Link ID> - _Deletes a ntnx.tips link_ \n \
       4. @shorty clicks <Link ID> - _How many times has a ntnx.tips link been clicked_');
});

controller.hears(['look like','look familiar'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'My mother was a cyborg, and I never met my father, but I heard he was some hotshot sales manager in Fed back in the day.');
});

controller.hears(['identify yourself', 'who are you', 'what is your name','what is your purpose'],
    'direct_message,direct_mention,mention', function(bot, message) {

        bot.reply(message,
            ':robot_face: I am a bot named <@' + bot.identity.name +
             '>. _I came here to crush beers and shorten links, and I\'m all out of beers._ \n\n DM @shorty \'help\' to learn more!');

    });