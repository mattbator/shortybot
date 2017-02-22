/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a simple Slack bot based on Botkit used to generate http://ntnx.tips/
short links. And it does some sass.

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

controller.hears(['kate reed','kreed'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'http://gph.is/1SQusZM');
});

controller.hears(['peter brass','brass'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'https://media2.giphy.com/media/ooG93rZFlcAk8/giphy.gif');
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
             bot.reply(message,':tada: Your new short URL is: http://'+newLink.shortUrl+' :tada:');
			 bot.startPrivateConversation(message,function(err,dm) {
    		 	dm.say(newLink.shortUrl+' - Link ID - ' +newLink.id+'\n @shorty clicks '+newLink.id+' - _Tells you how many times your shortened link has been clicked_\n @shorty delete '+newLink.id+' - _Deletes your shortened link_');
			 });
           } else {
             bot.reply(message,'*Beep boop!* Uh-oh, friend! Looks like there\'s an error that @matt hasn\'t handled yet! Most likely your Slashtag already exists, you used a bogus link, or you got cute and tried to add :jonkohler: emojis!');
           }
      })
});

controller.hears(['delete (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var linkId = message.match[1];
   
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

controller.hears(['get shorty'], 'direct_message,direct_mention,mention', function(bot, message) {
	var randQuote = { 
		0:'_Now I\'ve been shot at three times before. Twice on purpose and once by accident. And I\'m still here. And I\'m gonna be here for as long as I want to be._', 
		1:'_I\'m not gonna say any more than I have to, if that._',
		2:'I\'m just a :robot_face:, but if I had a car it would totally be the Cadillac of minivans.',
		3:'_I think you oughta turn around and go back to Miami._',
		}
    bot.reply(message,pickRandomProperty(randQuote));
});

controller.hears(['get down'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'https://media3.giphy.com/media/10SFlDV4sry9Ow/giphy.gif');
});

controller.hears(['go','birthday'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'http://gph.is/2dtpUZf');
    var randGif = { 
		0:'http://gph.is/2dtpUZf', 
		1:'https://media4.giphy.com/media/l4KhS0BOFBhU2SYIU/giphy.gif',
		2:'https://media0.giphy.com/media/nTb2dakirsu88/giphy.gif',
		3:'https://media2.giphy.com/media/s2qXK8wAvkHTO/giphy.gif'
		}
    bot.reply(message,pickRandomProperty(randGif));
});

controller.hears(['fuck you'], 'direct_message,direct_mention,mention', function(bot, message) {
	var randGif = { 
		0:'https://media1.giphy.com/media/3oz8xRd39FNNdzZjGw/giphy.gif', 
		1:'https://media3.giphy.com/media/tfzw8nJe6FPFK/giphy.gif',
		2:'https://media3.giphy.com/media/ywtJsowFklRvO/giphy.gif',
		3:'https://media3.giphy.com/media/uu1tMLrHG0Uj6/giphy.gif',
		4:'https://media4.giphy.com/media/oyXs9oXayW3FS/giphy.gif',
		5:'https://media0.giphy.com/media/BMIjBCRvZUS76/giphy.gif'
		}
    bot.reply(message,pickRandomProperty(randGif));
});

controller.hears(['look like','look familiar'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message,'My mother was a cyborg, and I never met my father, but I heard he was some hotshot sales manager in Fed back in the day.');
});

controller.hears(['identify yourself', 'who are you', 'what is your name','what is your purpose','what do you do'],
    'direct_message,direct_mention,mention', function(bot, message) {

        bot.reply(message,
            ':robot_face: I am a bot named <@' + bot.identity.name +
             '>. _I came here to crush beers and shorten links, and I\'m all out of beers._ \n\n DM @shorty \'help\' to learn more!');
});

controller.hears(['hello','hi','hey'], 'direct_message,direct_mention,mention', function(bot, message) {

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
            bot.reply(message, 'Hi! Long time, no talk!');
        }
    });
});

function pickRandomProperty(obj) {
    var result;
    var count = 0;
    for (var prop in obj)
        if (Math.random() < 1/++count)
           result = prop;
    return obj[result];
}