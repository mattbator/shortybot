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

var request = require('request');

var linksPerPage = 10;

var Botkit = require('./lib/Botkit.js');

if (!process.env.SLACK_CLIENT_ID ||
  !process.env.SLACK_SECRET ||
  !process.env.SLACK_PORT ||
  !process.env.REBRANDLY_API ||
  !process.env.GOOGL_API ||
  !process.env.DOMAIN_ID ||
  !process.env.MONGO_URI) {
  console.log('ERROR: Missing environment variables');
  process.exit(1);
}


var controller = Botkit.slackbot({
  // interactive_replies: true, // tells botkit to send button clicks into conversations
  json_file_store: './db_slackbutton_bot/',
  debug: false,
  // rtm_receive_messages: false, // disable rtm_receive_messages if you enable events api
}).configureSlackApp({
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_SECRET,
  scopes: ['bot'],
});

controller.setupWebserver(process.env.SLACK_PORT, function(err, webserver) {
  controller.createWebhookEndpoints(controller.webserver);

  controller.createOauthEndpoints(controller.webserver, function(err, req, res) {
    if (err) {
      res.status(500).send('ERROR: ' + err);
    } else {
      res.send('Success!');
    }
  });
});

var mongoStorage = require('mongodb').MongoClient;

// Connect to the db
mongoStorage.connect(process.env.MONGO_URI, function(err, db) {
  if (!err) {
    console.log('Connected to :' + process.env.MONGO_URI);
  } else {
    console.log('Failed to connect to :' + process.env.MONGO_URI);
    process.exit();
  }
  db.createCollection('links', function(err, collection) {
    if (err) {
      controller.log.error('Failed to create "links" collection: ' + err);
    }
  });
  var collection = db.collection('links');

  // just a simple way to make sure we don't
  // connect to the RTM twice for the same team
  var _bots = {};

  function trackBot(bot) {
    _bots[bot.config.token] = bot;
  }

  controller.on('interactive_message_callback', function(bot, message) {

    switch (message.actions[0].name) {
      case 'showMore':
        var index = message.actions[0].value;

        listLinks(message.user, index, function(err, reply) {
          bot.replyInteractive(message, reply);
        });
        break;

      case 'delete':
        var ids = message.actions[0].value.split(/\-/);
        var index = parseInt(ids[0]);
        var linkid = ids[1];

        linkDelete(linkid, function(err, link) {
          if (err) {
            bot.reply(message, '*Beep Boop!* Failed to delete link.')
          } else {
            listLinks(message.user, index, function(err, reply) {
              bot.replyInteractive(message, reply);
            });
          }
        });
        break;

      case 'deleteFromStats':
        var ids = message.actions[0].value.split(/\-/);
        var linkid = ids[0];
        var shorturl = ids[1];

        linkDelete(linkid, function(err, link) {
          if (err) {
            bot.reply(message, '*Beep Boop!* Failed to delete link.');
          } else {
            bot.replyInteractive(message, '*Beep Boop!*' + shorturl + ' has been deleted :skull_and_crossbones:');
          }
        });

        break;

      case 'stats':
        var ids = message.actions[0].value.split(/\-/);
        var googlid = ids[0];
        var shorturl = ids[1];
        var index = ids[2];
        var linkid = ids[3];

        statsGet(googlid, function(err, stats) {
          if (stats == null) {
            bot.reply(message, '*Beep Boop!* Looks like I failed to retrieve stats for ' + shorturl);
          } else {
            printStats(stats, shorturl, linkid, index, true, message.user, function(err, reply) {
              bot.replyInteractive(message, reply);
            });

          }
        });
        break;
    }
  });

  controller.on('create_bot', function(bot, config) {

    if (_bots[bot.config.token]) {
      // already online! do nothing.
    } else {
      bot.startRTM(function(err) {

        if (!err) {
          trackBot(bot);
        }

        bot.startPrivateConversation({
          user: config.createdBy
        }, function(err, convo) {
          if (err) {
            console.log(err);
          } else {
            convo.say('I am a bot that has just joined your team');
            convo.say('You must now /invite me to a channel so that I can be of use!');
          }
        });

      });
    }
  });

  // Handle events related to the websocket connection to Slack
  controller.on('rtm_open', function(bot) {
    console.log('** The RTM api just connected!');
  });

  controller.on('rtm_close', function(bot) {
    console.log('** The RTM api just closed');

    //restart RTM connection
    bot.startRTM(function(err) {

      if (!err) {
        trackBot(bot);
      }
    });
  });

  controller.hears(['kate reed', 'kreed'], 'direct_message,direct_mention,mention', function(bot, message) {
    var reply = {
      attachments: [{
        fallback: "Ahem.",
        title: "Ahem.",
        title_link: "http://giphy.com/search/crazy-cat-lady",
        image_url: "http://i.giphy.com/26tk0U8V02E2890oU.gif",
        color: "#AFD135"
      }]
    }
    bot.reply(message, reply);
  });

  controller.hears(['peter brass', 'brass'], 'direct_message,direct_mention,mention', function(bot, message) {
    var reply = {
      attachments: [{
        fallback: "Who?",
        title: "Who?",
        title_link: "http://giphy.com/search/who",
        image_url: "https://media2.giphy.com/media/ooG93rZFlcAk8/giphy.gif",
        color: "#AFD135"
      }]
    }
    bot.reply(message, reply);
  });

  controller.hears(['get down'], 'direct_message,direct_mention,mention', function(bot, message) {
    var reply = {
      attachments: [{
        fallback: "You know it.",
        title: "You know it.",
        title_link: "https://youtu.be/3KL9mRus19o?t=33",
        image_url: "https://media3.giphy.com/media/10SFlDV4sry9Ow/giphy.gif",
        color: "#AFD135"
      }]
    }
    bot.reply(message, reply);
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

  controller.hears(['go shorty', 'birthday'], 'direct_message,direct_mention,mention', function(bot, message) {
    var reply = {
      attachments: [{
        fallback: "Party like it's ya birthday!",
        title: "Party like it's ya birthday!",
        title_link: "https://youtu.be/UXcCCYBYVAM",
        image_url: "http://i.giphy.com/CFGzMVTg5T9gA.gif",
        color: "#AFD135"
      }]
    }
    bot.reply(message, reply);
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
    var reply = {
      attachments: [{
        fallback: "Back atcha <@" + message.user + "> :thumbsup:",
        title: "Back atcha <@" + message.user + "> :thumbsup:",
        title_link: "https://youtu.be/XwLLH9EZiqc?t=8",
        image_url: pickRandomProperty(randGif),
        color: "#AFD135"
      }]
    }
    bot.reply(message, reply);
  });

  controller.hears(['look like', 'look familiar'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.reply(message, 'My mother was a cyborg, and I never met my father, but I heard he was some hotshot sales manager in Fed back in the day. :gwyn:');
  });

  controller.hears(['hello', 'hi', 'hey', 'hola', 'greetings'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.api.reactions.add({
      timestamp: message.ts,
      channel: message.channel,
      name: 'robot_face',
    }, function(err, res) {
      if (err) {
        bot.botkit.log('Failed to add emoji reaction :(', err);
      }
    });
    bot.reply(message, 'Hi <@' + message.user + '>! Type \'@shorty help\' to learn more about Shortybot.');
  });

  controller.hears(['help'], 'direct_message,direct_mention,mention', function(bot, message) {
    var reply = {
      attachments: [{
        fallback: "I hope to learn lots of totally sweet tricks one day, in the meantime you should find these commands useful:",
        thumb_url: "http://emojipedia-us.s3.amazonaws.com/cache/c8/2a/c82abe67c3792acbaa5ee5917a6400cf.png",
        text: "I hope to learn lots of totally sweet tricks one day, in the meantime you should find these commands useful:",
        title: "*Beep Boop! I\'m a bot that helps you to shorten links!*",
        color: "#AFD135"
      }, {
        text: "@shorty shorten \'Ugly Long URL\' - Creates a ntnx.tips URL with a short, random Slashtag e.g. http://ntnx.tips/rngg",
        color: "#024DA1"
      }, {
        text: "@shorty shorten \'Ugly Long URL\' \'Slashtag\' - Creates a ntnx.tips URL with a sweet, custom Slashtag e.g. http://ntnx.tips/MattRocks",
        color: "#024DA1"
      }, {
        text: "@shorty stats \'Slashtag\' - Retrieves stats for an ntnx.tips URL - Also works with full ntnx.tips/slashtag link",
        color: "#024DA1"
      }, {
        text: "@shorty list - Retrieves a list of all of the ntnx.tips/ links you\'ve created",
        color: "#024DA1"
      }]
    }
    bot.reply(message, reply);
  });

  controller.hears(['list', 'links', 'mylinks', 'mylist'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.startPrivateConversation(message, function(err, dm) {
      listLinks(message.user, 0, function(err, reply) {
        dm.say(reply);
      });
    });
  });

  controller.hears(['stats (.*)', 'clicks (.*)', 'delete (.*)', 'info (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var slashId = message.match[1].replace(/.*ntnx.tips\//, '');
    slashId = slashId.replace(/\W/g, '');

    bot.startPrivateConversation(message, function(err, dm) {
      collection.findOne({
        'slashid': slashId
      }, function(err, item) {
        if (item == null) {
          dm.say('*Beep Boop!* Failed to return db entry for http://ntnx.tips/' + slashId);
          controller.log.error('Cannot find slashid ' + slashId + 'in the db: ' + err);
        } else {
          linkGet(item.linkid, function(err, link) {
            if (err) {
              dm.say('*Beep Boop!* I couldn\'t find http://ntnx.tips/' + item.slashid)
            } else {
              statsGet(link.integration.link, function(err, stats) {
                if (stats == null) {
                  dm.say('*Beep Boop!* Looks like I failed to retrieve stats for http://ntnx.tips/' + item.slashid);
                } else {
                  printStats(stats, link.shortUrl, link.id, 0, false, message.user, function(err, reply) {
                    dm.say(reply);
                  });
                }
              });
            }
          });
        }
      });
    });
  });

  controller.hears(['shorten (.*) (.*)', 'shorten (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var oldLink = message.match[1];
    var slashId = message.match[2];

    //Parse our any garbage around the tag
    if (slashId !== undefined) {
      slashId = slashId.replace(/\W/g, '');
    }

    //Parse out hyperlink text from Slack message
    oldLink = oldLink.replace('<', '');
    oldLink = oldLink.replace('>', '');
    oldLink = oldLink.replace('\'', '');
    oldLink = oldLink.replace('\"', '');
    oldLink = oldLink.split('|');
    oldLink = JSON.stringify(oldLink);
    var oldLinkObj = JSON.parse(oldLink);

    //check to make sure we're not attempting to shorten an ntnx.tips link
    if (oldLinkObj[0].includes('ntnx.tips')) {
      bot.reply(message, ':rage: You know who else loves to shorten already shortened links?! ISIS. I hope you\'re proud of yourself.');
    } else {
      request({
        uri: 'https://api.rebrandly.com/v1/links',
        method: "POST",
        body: JSON.stringify({
          destination: oldLinkObj[0],
          slashtag: slashId,
          title: message.user,
          domain: {
            id: process.env.DOMAIN_ID
          }
        }),
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.REBRANDLY_API
        }
      }, function(err, response, body) {
        controller.debug('Shorten HTTP RESPONSE: ' + JSON.stringify(response));
        if (!err && response.statusCode == 200) {
          var newLink = JSON.parse(body);
          bot.reply(message, 'Your new :link: is: http://' + newLink.shortUrl);

          var now = new Date();
          var record = {
            'slashid': newLink.slashtag,
            'userid': message.user,
            'linkid': newLink.id,
            'createdDate': now.getFullYear() + '-' + now.getMonth() + 1 + '-' + now.getDate()
          };
          collection.insert(record, {
            w: 1
          }, function(err, result) {
            if (err) {
              bot.reply(message, '*Beep Boop!* Hey will you tell <@matt> that I just failed to enter ' + newLink.slashtag + ' into the database?');
              controller.log.error('Failed to add ' + newLink.slashtag + ' to db: ' + err);
            }
          });
        } else {
          controller.log.error('Failed to create short link http://ntnx.tips/' + slashId + ': ' + JSON.stringify(response));
          bot.reply(message, '*Beep Boop!* Uh-oh, friend! I couldn\'t shorten your link! Most likely another user created a link with that Slashtag, you used a bogus link, or you got cute and tried to add :jonkohler: emojis!');
        }
      })
    }
  });

  controller.hears(['today-report'], 'direct_message,direct_mention,mention', function(bot, message) {

    var now = new Date();
    var today = now.getFullYear() + '-' + now.getMonth() + 1 + '-' + now.getDate()

    collection.find({
      'createdDate': today
    }).toArray(function(err, items) {
      if (items.length == 0) {
        bot.reply(message, '*Beep Boop!* I must be putting the Slack in slacker because I haven\'t shortened *any* new links today!')
        controller.log.error('Could not find db entries for createdDate ' + today);
      } else {
        var reply = '*Beep Boop!* I\'ve shortened ' + items.length + ' new links today!\n'
        for (var i = 0; i < items.length; i++) {
          reply += '\nhttp://ntnx.tips/' + items[i].slashid + ' - <@' + items[i].userid + '>'
        }
        bot.reply(message, reply)
      }
    });
  });

  controller.hears(['mypopular'], 'direct_message,direct_mention,mention', function(bot, message) {

    findUserLinks(message.user, function(err, items) {
      if (items == null) {
        bot.reply(message, '*Beep Boop!* Uh-oh, friend! Looks like I can\'t find any of your links! If you\'re sure you\'ve created some, maybe go talk to <@matt>.')
      } else {
        // get stats for each link, load into array, sort array, print output
      }

    });
  });

  /*controller.hears('^stop', 'direct_message', function(bot, message) {
    bot.reply(message, 'Goodbye');
    bot.rtm.close();
  });

  controller.on(['direct_message', 'mention', 'direct_mention'], function(bot, message) {
    bot.api.reactions.add({
      timestamp: message.ts,
      channel: message.channel,
      name: 'robot_face',
    }, function(err) {
      if (err) {
        console.log(err)
      }
      bot.reply(message, 'I heard you loud and clear boss.');
    });
  });*/

  controller.storage.teams.all(function(err, teams) {

    if (err) {
      throw new Error(err);
    }

    // connect all teams with bots up to slack!
    for (var t in teams) {
      if (teams[t].bot) {
        controller.spawn(teams[t]).startRTM(function(err, bot) {
          if (err) {
            console.log('Error connecting bot to Slack:', err);
          } else {
            trackBot(bot);
          }
        });
      }
    }

  });

  function printStats(stats, shorturl, linkid, index, fromlist, user, callback) {

    collection.findOne({
      'linkid': linkid
    }, function(err, item) {
      if (item == null) {
        var reply = '*Beep Boop!* Failed to print stats for http://' + shorturl
        controller.log.error('Cannot find linkid ' + linkid + 'in the db: ' + err);
        callback(true, reply);
      } else {

        //All Time Stats
        var totalText = 'Clicks: ' + stats.analytics.allTime.shortUrlClicks
        if (stats.analytics.allTime.countries) {

          for (var i = 0; i < stats.analytics.allTime.countries.length; i++) {
            totalText += '\nCountry - ' + stats.analytics.allTime.countries[i].id + ': ' + stats.analytics.allTime.countries[i].count
          }
          for (var i = 0; i < stats.analytics.allTime.browsers.length; i++) {
            totalText += '\nBrowser - ' + stats.analytics.allTime.browsers[i].id + ': ' + stats.analytics.allTime.browsers[i].count
          }
          for (var i = 0; i < stats.analytics.allTime.platforms.length; i++) {
            totalText += '\nPlatform - ' + stats.analytics.allTime.platforms[i].id + ': ' + stats.analytics.allTime.platforms[i].count
          }
        }

        //This Month Stats
        var monthText = 'Clicks: ' + stats.analytics.month.shortUrlClicks

        if (stats.analytics.month.countries) {
          for (var i = 0; i < stats.analytics.month.countries.length; i++) {
            monthText += '\nCountry - ' + stats.analytics.month.countries[i].id + ': ' + stats.analytics.month.countries[i].count
          }
          for (var i = 0; i < stats.analytics.month.browsers.length; i++) {
            monthText += '\nBrowser - ' + stats.analytics.month.browsers[i].id + ': ' + stats.analytics.month.browsers[i].count
          }
          for (var i = 0; i < stats.analytics.month.platforms.length; i++) {
            monthText += '\nPlatform - ' + stats.analytics.month.platforms[i].id + ': ' + stats.analytics.month.platforms[i].count
          }
        }

        //This Week Stats
        var weekText = 'Clicks: ' + stats.analytics.week.shortUrlClicks

        if (stats.analytics.week.countries) {
          for (var i = 0; i < stats.analytics.week.countries.length; i++) {
            weekText += '\nCountry - ' + stats.analytics.week.countries[i].id + ': ' + stats.analytics.week.countries[i].count
          }
          for (var i = 0; i < stats.analytics.week.browsers.length; i++) {
            weekText += '\nBrowser - ' + stats.analytics.week.browsers[i].id + ': ' + stats.analytics.week.browsers[i].count
          }
          for (var i = 0; i < stats.analytics.week.platforms.length; i++) {
            weekText += '\nPlatform - ' + stats.analytics.week.platforms[i].id + ': ' + stats.analytics.week.platforms[i].count
          }
        }

        //Today Stats
        var dayText = 'Clicks: ' + stats.analytics.day.shortUrlClicks

        if (stats.analytics.day.countries) {
          for (var i = 0; i < stats.analytics.day.countries.length; i++) {
            dayText += '\nCountry - ' + stats.analytics.day.countries[i].id + ': ' + stats.analytics.day.countries[i].count
          }
          for (var i = 0; i < stats.analytics.day.browsers.length; i++) {
            dayText += '\nBrowser - ' + stats.analytics.day.browsers[i].id + ': ' + stats.analytics.day.browsers[i].count
          }
          for (var i = 0; i < stats.analytics.day.platforms.length; i++) {
            dayText += '\nPlatform - ' + stats.analytics.day.platforms[i].id + ': ' + stats.analytics.day.platforms[i].count
          }
        }

        //Last Two Hours Stats
        var twoHourText = 'Clicks: ' + stats.analytics.twoHours.shortUrlClicks

        if (stats.analytics.twoHours.countries) {
          for (var i = 0; i < stats.analytics.twoHours.countries.length; i++) {
            twoHourText += '\nCountry - ' + stats.analytics.twoHours.countries[i].id + ': ' + stats.analytics.twoHours.countries[i].count
          }
          for (var i = 0; i < stats.analytics.twoHours.browsers.length; i++) {
            twoHourText += '\nBrowser - ' + stats.analytics.twoHours.browsers[i].id + ': ' + stats.analytics.twoHours.browsers[i].count
          }
          for (var i = 0; i < stats.analytics.twoHours.platforms.length; i++) {
            twoHourText += '\nPlatform - ' + stats.analytics.twoHours.platforms[i].id + ': ' + stats.analytics.twoHours.platforms[i].count
          }
        }

        var created = new Date(stats.created);
        var monthNames = ["January", "February", "March", "April", "May", "June",
          "July", "August", "September", "October", "November", "December"
        ];
        var statstitle = ''

        if (user = item.userid) {
          statstitle = "All Time - Link created on " + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
        } else {
          statstitle = "All Time - Link created on " + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear() + ' by <@' + item.userid + '>'
        }
        var reply = {
          text: '*Beep Boop!* Here\'s all I can tell you about http://' + shorturl,
          attachments: [{
            title: statstitle,
            thumb_url: 'http://emojipedia-us.s3.amazonaws.com/cache/ea/b4/eab4395537306eaf63806710022ecc8f.png',
            text: totalText,
            color: "#024DA1"
          }],
        }
        if (stats.analytics.allTime.shortUrlClicks > 0) {
          reply.attachments.push({
            title: "This Month",
            text: monthText,
            color: "#024DA1"
          }, {
            title: "This Week",
            text: weekText,
            color: "#024DA1"
          }, {
            title: "Today",
            text: dayText,
            color: "#024DA1"
          }, {
            title: "Last Two Hours",
            text: twoHourText,
            color: "#024DA1"
          })
        }

        if (fromlist) {
          reply.attachments.push({
            title: 'Actions',
            callback_id: user,
            color: "#AFD135",
            attachment_type: 'default',
            actions: [{
              "name": "showMore",
              "text": "Return",
              "value": index,
              "type": "button",
            }, {
              "text": "Delete Link",
              "name": "delete",
              "value": index + '-' + linkid,
              "style": "danger",
              "type": "button",
              "confirm": {
                "title": "Confirm",
                "text": "Are you sure you want to delete " + shorturl + "?",
                "ok_text": "Yes",
                "dismiss_text": "No"
              }
            }]
          })
        } else if (user = item.userid) {
          reply.attachments.push({
            title: 'Actions',
            callback_id: user,
            color: "#AFD135",
            attachment_type: 'default',
            actions: [{
              "text": "Delete Link",
              "name": "deleteFromStats",
              "value": linkid + '-' + shorturl,
              "style": "danger",
              "type": "button",
              "confirm": {
                "title": "Confirm",
                "text": "Are you sure you want to delete " + shorturl + "?",
                "ok_text": "Yes",
                "dismiss_text": "No"
              }
            }]
          })
        }
        callback(null, reply);
      }
    });
  }

  function listLinks(user, index, callback) {
    var reply = {};
    var index = parseInt(index);
    var begin = index + 1; //6
    var end = index + linksPerPage; //10

    findUserLinks(user, function(err, items) {
      if (err || items.length == 0) {
        reply = '*Beep Boop!* Uh-oh, friend! Looks like I can\'t find any of your links! If you\'re sure you\'ve created some, maybe go talk to <@matt>.'
        controller.log.error('Failed to print link list for userid: ' + user);
        callback(true, reply);
      } else {

        if (end > items.length) {
          end = items.length //5
        }
        if (begin > items.length) {
          index = begin - linksPerPage - 1
          begin = index
        }

        var reply = {
          text: '*Beep Boop!* I\'ve shortened *' + items.length + '* links for you, <@' + user + '>!\nLinks ' + begin + ' - ' + end + ':',
          attachments: [],
        }

        function looper(i) {
          if (i < linksPerPage && i + index < items.length) {
            linkGet(items[i + index].linkid, function(err, link) {
              if (link == null) {
                looper(i + 1);
              } else {
                reply.attachments.push({
                  title: link.shortUrl,
                  text: link.destination,
                  callback_id: user,
                  color: "#024DA1",
                  attachment_type: 'default',
                  actions: [{
                    "name": "stats",
                    "text": "Get Stats",
                    "value": link.integration.link + '-' + link.shortUrl + '-' + index + '-' + items[i + index].linkid,
                    "type": "button",
                  }, {
                    "text": "Delete Link",
                    "name": "delete",
                    "value": index + '-' + items[i + index].linkid,
                    "style": "danger",
                    "type": "button",
                    "confirm": {
                      "title": "Confirm",
                      "text": "Are you sure you want to delete " + link.shortUrl + "?",
                      "ok_text": "Yes",
                      "dismiss_text": "No"
                    }
                  }]
                })
                looper(i + 1);
              }
            });
          } else {
            if (i + index < items.length && i > 1 && index > 0) {
              reply.attachments.push({
                title: 'Show more links?',
                callback_id: user,
                color: "#AFD135",
                attachment_type: 'default',
                actions: [{
                  "name": "showMore",
                  "text": "Previous",
                  "value": index - linksPerPage,
                  "type": "button",
                }, {
                  "name": "showMore",
                  "text": "Next",
                  "value": i + index,
                  "type": "button",
                }]
              })
            } else if (i + index < items.length) {
              reply.attachments.push({
                title: 'Show more links?',
                callback_id: user,
                color: "#AFD135",
                attachment_type: 'default',
                actions: [{
                  "name": "showMore",
                  "text": "Next",
                  "value": i + index,
                  "type": "button",
                }]
              })
            } else if (items.length > linksPerPage) {
              reply.attachments.push({
                title: 'Show more links?',
                callback_id: user,
                color: "#AFD135",
                attachment_type: 'default',
                actions: [{
                  "name": "showMore",
                  "text": "Previous",
                  "value": index - linksPerPage,
                  "type": "button",
                }]
              })
            }
            callback(false, reply);
          }
        }
        looper(0);
      }
    });
  }

  function findUserLinks(userid, callback) {
    var items = []
    collection.find({
      'userid': userid
    }).toArray(function(err, items) {
      if (items.length < 1) {
        controller.log.error('Could not find db entries for userid ' + userid + ': ' + err);
        callback(true, null);
      } else {
        callback(null, items);
      }
    });
  }

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
        collection.remove({
          'linkid': id
        }, {
          w: 1
        }, function(err, result) {
          if (!err) {
            callback(null, link);
          } else {
            controller.log.error('Removing link entry from database failed: ' + err);
            callback(true);
          }
        });

      } else {
        controller.log.error('Failed to delete link ' + id + ': ' + JSON.stringify(response));
        callback(true);
      }
    });
  }
});

function statsGet(id, callback) {
  request({
    uri: 'https://www.googleapis.com/urlshortener/v1/url?shortUrl=' + id + '&projection=FULL&key=' + process.env.GOOGL_API,
    method: "GET",
    headers: {
      'Content-Type': 'application/json',
    }
  }, function(err, response, body) {
    if (!err && response.statusCode == 200) {
      var stats = JSON.parse(body);
      callback(null, stats);
    } else {
      controller.log.error('Failed to return Goo.gl stats for ' + googlid + ': ' + JSON.stringify(response));
      callback(true);
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
      controller.log.error('Failed to return link for ' + id + ': ' + JSON.stringify(response));
      callback(true);
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