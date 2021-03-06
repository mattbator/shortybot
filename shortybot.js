/*~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
           ______     ______     ______   __  __     __     ______
          /\  == \   /\  __ \   /\__  _\ /\ \/ /    /\ \   /\__  _\
          \ \  __<   \ \ \/\ \  \/_/\ \/ \ \  _"-.  \ \ \  \/_/\ \/
           \ \_____\  \ \_____\    \ \_\  \ \_\ \_\  \ \_\    \ \_\
            \/_____/   \/_____/     \/_/   \/_/\/_/   \/_/     \/_/


This is a simple Slack bot based on Botkit used to generate http://ntnx.tips/
short links. And it does some sass.

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~*/

require('dotenv').config({
  path: __dirname + '/.env'
});

var Botkit = require('./lib/Botkit.js');
var request = require('request');
//var mongoStorage = require('botkit-storage-mongo')({mongoUri: MONGO_URI});
var mongoStorage = require('mongodb').MongoClient;

// Connect to the db
mongoStorage.connect(process.env.MONGO_URI, function(err, db) {
  if (!err) {
    console.log('Connected to :' + process.env.MONGO_URI);
  } else {
    console.log('Failed to connect to :' + process.env.MONGO_URI);
    process.exit();
  }
  db.createCollection('links', function(err, collection) {});
  var collection = db.collection('links');

  var controller = Botkit.slackbot({
    //storage: mongoStorage,
    debug: false,
  });

  var bot = controller.spawn({
    token: process.env.SLACK_TOKEN
  }).startRTM();

  controller.hears(['kate reed', 'kreed'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message, 'http://gph.is/1SQusZM');
  });

  controller.hears(['peter brass', 'brass'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message, 'https://media2.giphy.com/media/ooG93rZFlcAk8/giphy.gif');
  });

  controller.hears(['shorten (.*) (.*)', 'shorten (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var oldLink = message.match[1];
    var slashId = message.match[2];

    //Parse our any garbage around the tag
    if (slashId !== undefined) {
      slashId = slashId.replace(/\W/g,'');
    }

    //Parse out hyperlink text from Slack message
    oldLink = oldLink.replace('<', '');
    oldLink = oldLink.replace('>', '');
    oldLink = oldLink.replace('\'', '');
    oldLink = oldLink.replace('\"', '');
    oldLink = oldLink.split('|');
    oldLink = JSON.stringify(oldLink);
    var oldLinkObj = JSON.parse(oldLink);

    bot.startPrivateConversation(message, function(err, dm) {

      //check to make sure we're not attempting to shorten an ntnx.tips link
      if (oldLinkObj[0].includes('ntnx.tips')) {
        dm.say(':rage: You know who else loves to shorten already shortened links?! ISIS. I hope you\'re proud of yourself.');
      } else {
        request({
          uri: 'https://api.rebrandly.com/v1/links',
          method: "POST",
          body: JSON.stringify({
            destination: oldLinkObj[0],
            slashtag: slashId,
            description: oldLinkObj[0],
            domain: {
              id: process.env.DOMAIN_ID
            }
          }),
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.REBRANDLY_API
          }
        }, function(err, response, body) {
          if (!err && response.statusCode == 200) {
            var newLink = JSON.parse(body);
            dm.say(':tada: Your new short URL is: http://' + newLink.shortUrl);
            dm.next();
            var record = {
              'slashid': newLink.slashtag,
              'userid': message.user,
              'linkid': newLink.id
            };
            collection.insert(record, {
              w: 1
            }, function(err, result) {
              if (err) {
                dm.say('*Beep boop!* Hey will you tell <@matt> that I just failed to enter that link into the database?\n*ERROR:* ' + err);
                console.log('ERROR ADDING LINK TO DB: ' + err);
              }
            });
          } else {
            dm.say('*Beep boop!* Uh-oh, friend! I couldn\'t shorten your link! Most likely another user created a link with that Slashtag, you used a bogus link, or you got cute and tried to add :jonkohler: emojis!');
          }
        })
      }
    });
  });

  controller.hears(['delete (.*) (.*)','delete (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var slashId = message.match[1].replace(/.*ntnx.tips\//, '');
    var forceDelete = message.match[2];
    slashId = slashId.replace(/\W/g,'');
    bot.startPrivateConversation(message, function(err, dm) {

      collection.findOne({
        'slashid': slashId
      }, function(err, item) {
        if (item == null) {
          dm.say('*Beep boop!* Uh-oh, friend! Looks like the Slashtag \"' + slashId + '\" doesn\'t exist!\n*ERROR:* ' + err);
          dm.next();
        } else if (item.userid !== message.user) {
          dm.say('*Beep boop!* Uh-oh, friend! Looks like that link isn\'t yours to delete! Maybe go talk to <@matt> if you think that\'s not correct.');
          dm.next()
        } else {
          if (forceDelete == 'yes' || forceDelete == 'y' || forceDelete == 'force') {
            linkDelete(item.linkid, function(err, link) {
              if (err) {
                dm.say('*Beep boop!* Uh-oh, friend! Looks like the Slashtag \"' + slashId + '\" doesn\'t exist!\n ERROR: ' + err);
                dm.next();
              } else {
                dm.say(':skull_and_crossbones: http://' + link.shortUrl + ' has been deleted. I hope you\'re happy.');
                dm.next();
                collection.remove({
                  'slashid': slashId
                }, {
                  w: 1
                }, function(err, result) {
                  if (err) {
                    dm.say('*Beep boop!* Hey will you tell <@matt> that I just failed to delete that link from the database?\n*ERROR:* ' + err);
                    dm.next();
                  }
                });
              }
            })
          } else {
            linkGet(item.linkid, function(err, link) {
              if (err) {
                dm.say('*Beep boop!* Uh-oh, friend! Looks like the Slashtag \"' + slashId + '\" doesn\'t exist!\n*ERROR:* ' + err);
                dm.next();
              } else {
                  dm.ask('Are you *sure* you want to delete http://' + link.shortUrl + ', which redirects to ' + link.destination + '?', [{
                    pattern: bot.utterances.yes,
                    callback: function(response, dm) {
                      linkDelete(item.linkid, function(err, link) {
                        if (err) {
                          dm.say('*Beep boop!* Uh-oh, friend! Looks like the Slashtag \"' + slashId + '\" doesn\'t exist!\n ERROR: ' + err);
                          dm.next();
                        } else {
                          dm.say(':skull_and_crossbones: http://ntnx.tips/' + slashId + ' has been deleted. I hope you\'re happy.');
                          dm.next();
                          collection.remove({
                            'slashid': slashId
                          }, {
                            w: 1
                          }, function(err, result) {
                            if (err) {
                              dm.say('*Beep boop!* Hey will you tell <@matt> that I just failed to delete that link from the database?\n*ERROR:* ' + err);
                              dm.next();
                            } else {
                              dm.next();
                            }
                          });
                        }
                      })
                    }
                  }, {
                    pattern: bot.utterances.no,
                    default: true,
                    callback: function(response, dm) {
                      dm.say('*Beep boop!* That was a close one!');
                      dm.next();
                    }
                  }]);
              }
            })
          }
        }
      });
    });
  });

  controller.hears(['info (.*)', 'clicks (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var slashId = message.match[1].replace(/.*ntnx.tips\//, '');
    slashId = slashId.replace(/\W/g,'');
    bot.startPrivateConversation(message, function(err, dm) {

      collection.findOne({
        'slashid': slashId
      }, function(err, item) {
        if (item == null) {
          dm.say('*Beep boop!* Uh-oh, friend! Looks like the Slashtag \"' + slashId + '\" doesn\'t exist!\n*ERROR:* ' + err);
          dm.next();
        } else {
          linkGet(item.linkid, function(err, link) {
            if (err) {
              dm.say('*Beep boop!* Uh-oh, friend! Looks like the Slashtag \"' + slashId + '\" doesn\'t exist!\n*ERROR:* ' + err);
              dm.next();
              console.log('ERROR: ' + err);
            } else {
              var created = new Date(link.createdAt)
              dm.say('http://' + link.shortUrl + ' has been clicked ' + link.clicks + ' times since it was created on ' + created);
            }
          })
        }
      });
    });
  });

  controller.hears(['mylinks','mylist','list'], 'direct_message,direct_mention,mention', function(bot, message) {
    findLinks(message.user, function(err, items) {
      bot.startPrivateConversation(message, function(err, dm) {
        if (items.length == 0) {
          dm.say('*Beep boop!* Uh-oh, friend! Looks like I can\'t find any of your links! If you\'re sure you\'ve created some, maybe go talk to <@matt>.\n*ERROR:* ' + err);
          dm.next();
        } else {

          var linksPerPage = 25;
          function page(j) {
            if (j < items.length) {
              var linklist = [];

              function looper(i) {
                if (i < j + linksPerPage && i + j < items.length) {
                  linkGet(items[i + j].linkid, function(err, link) {
                    if (err) {
                      dm.say('ERROR: ' + err);
                      dm.next();
                      console.log('ERROR: ' + err);
                    } else {
                      linklist.push(i + j + 1 + '.) http://' + link.shortUrl + '  :arrow_right:  ' + link.destination + '\n');
                      looper(i + 1);
                    }
                  })
                } else {

                    dm.say(linklist.join(''));
                    if (i + j < items.length) {
                      dm.ask('Display more links?', [{
                        pattern: bot.utterances.yes,
                        callback: function(response, dm) {
                          dm.next();
                          page(j + linksPerPage);
                        }
                      }, {
                        pattern: bot.utterances.no,
                        default: true,
                        callback: function(response, dm) {
                          dm.say('OK, see you next time!');
                          dm.next();
                        }
                      }]);
                    }

                }
              }
              looper(0);
            }
          }
          page(0);
          dm.say('*Beep boop!* I\'ve shortened *' + items.length + '* links for you.\n\n');
        }
      });
    });
  });

  controller.hears(['help'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message, ':robot_face:*Beep boop! I\'m a bot that helps you to shorten links!*\n\n \
       I hope to learn lots of totally sweet tricks one day, in the meantime you should find these commands useful: \n\n \
       1. @shorty shorten \'Ugly Long URL\' - _Creates a ntnx.tips URL with a short, random Slashtag e.g. ntnx.tips/rngg_ \n \
       2. @shorty shorten \'Ugly Long URL\' \'Slashtag\' - _Creates a ntnx.tips URL with a sweet, custom Slashtag e.g. ntnx.tips/MattRocks_ \n \
       3. @shorty delete \'Slashtag\' - _Deletes a ntnx.tips link - Also works with full ntnx.tips/slashtag link_ \n \
       4. @shorty clicks \'Slashtag\' - _Display how many times has a ntnx.tips link been clicked - Also works with full ntnx.tips/slashtag link_ \n \
       5. @shorty list - _Displays a list of all of the ntnx.tips/ links you\'ve created_ ');
  });

  controller.hears(['get shorty'], 'direct_message,direct_mention,mention', function(bot, message) {
    var randQuote = {
      0: '_Now I\'ve been shot at three times before. Twice on purpose and once by accident. And I\'m still here. And I\'m gonna be here for as long as I want to be._',
      1: '_I\'m not gonna say any more than I have to, if that._',
      2: 'I\'m just a :robot_face:, but if I had a car it would totally be the Cadillac of minivans.',
      3: '_I think you oughta turn around and go back to Miami._',
      4: '_<@matt> says that I\'m the Cadillac of Slackbots._',
    }
    bot.reply(message, pickRandomProperty(randQuote));
  });

  controller.hears(['get down'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message, 'https://media3.giphy.com/media/10SFlDV4sry9Ow/giphy.gif');
  });

  controller.hears(['go', 'birthday'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message, 'http://gph.is/2dtpUZf');
    var randGif = {
      0: 'http://gph.is/2dtpUZf',
      1: 'https://media4.giphy.com/media/l4KhS0BOFBhU2SYIU/giphy.gif',
      2: 'https://media0.giphy.com/media/nTb2dakirsu88/giphy.gif',
      3: 'https://media2.giphy.com/media/s2qXK8wAvkHTO/giphy.gif'
    }
    bot.reply(message, pickRandomProperty(randGif));
  });

  controller.hears(['fuck you'], 'direct_message,direct_mention,mention', function(bot, message) {
    var randGif = {
      0: 'https://media1.giphy.com/media/3oz8xRd39FNNdzZjGw/giphy.gif',
      1: 'https://media3.giphy.com/media/tfzw8nJe6FPFK/giphy.gif',
      2: 'https://media3.giphy.com/media/ywtJsowFklRvO/giphy.gif',
      3: 'https://media3.giphy.com/media/uu1tMLrHG0Uj6/giphy.gif',
      4: 'https://media4.giphy.com/media/oyXs9oXayW3FS/giphy.gif',
      5: 'https://media0.giphy.com/media/BMIjBCRvZUS76/giphy.gif'
    }
    bot.reply(message, pickRandomProperty(randGif));
  });

  controller.hears(['look like', 'look familiar'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message, 'My mother was a cyborg, and I never met my father, but I heard he was some hotshot sales manager in Fed back in the day.');
  });

  controller.hears(['identify yourself', 'who are you', 'what is your name', 'what is your purpose', 'what do you do'],
    'direct_message,direct_mention,mention',
    function(bot, message) {

      bot.reply(message,
        ':robot_face: I am a bot named <@' + bot.identity.name +
        '>. _I came here to crush beers and shorten links, and I\'m all out of beers._ \n\n DM @shorty \'help\' to learn more!');
    });

  controller.hears(['hello', 'hi', 'hey'], 'direct_message,direct_mention,mention', function(bot, message) {

    bot.api.reactions.add({
      timestamp: message.ts,
      channel: message.channel,
      name: 'robot_face',
    }, function(err, res) {
      if (err) {
        bot.botkit.log('Failed to add emoji reaction :(', err);
      }
    });
    bot.reply(message, 'Hi <@' +message.user+ '>! Type \'@shorty help\' to learn more about Shortybot.');
  });

  function findLinks(userid, callback) {
    collection.find({
      'userid': userid
    }).toArray(function(err, items) {
      if (err) {
        callback(err);
      }
      callback(null, items);
    });
  }

});

function linkDelete(id, callback) {
  request({
    uri: 'https://api.rebrandly.com/v1/links/' + id,
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.REBRANDLY_API
    }
  }, function(err, response, body) {
    if (!err && response.statusCode == 200) {
      var link = JSON.parse(body);
      callback(null, link);
    } else {
      callback(err);
    }
  });
}


function linkGet(id, callback) {
  request({
    uri: 'https://api.rebrandly.com/v1/links/' + id,
    method: "GET",
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.REBRANDLY_API
    }
  }, function(err, response, body) {
    if (!err && response.statusCode == 200) {
      var link = JSON.parse(body);
      callback(null, link);
    } else {
      callback(err);
    }
  });
}

function pickRandomProperty(obj) {
  var result;
  var count = 0;
  for (var prop in obj)
    if (Math.random() < 1 / ++count)
      result = prop;
  return obj[result];
}