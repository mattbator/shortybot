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

var cron = require('node-cron');

var linksPerPage = 8;

var monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var ONE_DAY = 24 * 60 * 60 * 1000;
var ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
var ONE_MONTH = 30 * 24 * 60 * 60 * 1000;

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
  var linkCollection = db.collection('links');

  db.createCollection('top', function(err, collection) {
    if (err) {
      controller.log.error('Failed to create "top" collection: ' + err);
    }
  });
  var topCollection = db.collection('top');

  // just a simple way to make sure we don't
  // connect to the RTM twice for the same team
  var _bots = {};

  function trackBot(bot) {
    _bots[bot.config.token] = bot;
  }

  controller.on('interactive_message_callback', function(bot, message) {

    switch (message.actions[0].name) {
      case 'showMore':
        var ids = message.actions[0].value.split(/\-/);
        var index = parseInt(ids[0]);
        var user = ids[1];

        listLinks(message.user, user, index, function(err, reply) {
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
            listLinks(message.user, message.user, index, function(err, reply) {
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
            bot.replyInteractive(message, shorturl + ' has been deleted :skull_and_crossbones:');
          }
        });

        break;

      case 'stats':
        var ids = message.actions[0].value.split(/\-/);
        var googlid = ids[0];
        var shorturl = ids[1];
        var index = ids[2];
        var linkid = ids[3];
        var destination = ids[4];

        statsGet(googlid, function(err, stats) {
          if (stats == null) {
            bot.reply(message, '*Beep Boop!* Looks like I failed to retrieve stats for ' + shorturl);
          } else {
            printStats(stats, shorturl, destination, linkid, index, true, message.user, function(err, reply) {
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

  controller.hears(['fuck you', 'fuck off'], 'direct_message,direct_mention,mention', function(bot, message) {
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
        text: "I hope to learn lots of totally awesome tricks one day, in the meantime you should find these commands useful:",
        title: "Beep Boop! I\'m a bot that helps you to shorten links!",
        color: "#AFD135"
      }, {
        title: "@shorty shorten \'Ugly Long URL\'",
        text: "Creates a ntnx.tips link with a short, random Slashtag e.g. http://ntnx.tips/rngg",
        color: "#024DA1"
      }, {
        title: "@shorty shorten \'Ugly Long URL\' \'Slashtag\'",
        text: "Creates a ntnx.tips link with a sweet, custom Slashtag e.g. http://ntnx.tips/MattRocks",
        color: "#024DA1"
      }, {
        title: "@shorty stats \'Slashtag\'",
        text: "Gets stats for an ntnx.tips link - Also works with full ntnx.tips/slashtag link",
        color: "#024DA1"
      }, {
        title: "@shorty list",
        text: "Interactive list all of the ntnx.tips links you\'ve created",
        color: "#024DA1"
      }, {
        title: "@shorty list \'@someuser\'",
        text: "Interactive list all of the ntnx.tips links that user has created",
        color: "#024DA1"
      }, {
        title: "@shorty my top",
        text: "Lists your personal top 10 most popular ntnx.tips links",
        color: "#024DA1"
      }, {
        title: "@shorty top",
        text: "Lists the global top 10 most popular ntnx.tips links - Updated every 2 hours",
        color: "#024DA1"
      }, {
        title: "@shorty activity",
        text: "What I've been up to (apart from all the Zumba classes)",
        color: "#024DA1"
      }]
    }
    bot.reply(message, reply);
  });

  controller.hears(['list (.*)', 'links (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var user = message.match[1];
    user = user.replace(/\W/g, '');

    bot.startPrivateConversation(message, function(err, dm) {
      listLinks(message.user, user, 0, function(err, reply) {
        dm.say(reply);
      });
    });
  });

  controller.hears(['list', 'links', 'mylinks', 'mylist'], 'direct_message,direct_mention,mention', function(bot, message) {
    bot.startPrivateConversation(message, function(err, dm) {
      listLinks(message.user, message.user, 0, function(err, reply) {
        dm.say(reply);
      });
    });
  });

  controller.hears(['stats (.*)', 'clicks (.*)', 'delete (.*)', 'info (.*)'], 'direct_message,direct_mention,mention', function(bot, message) {
    var slashId = message.match[1].replace(/.*ntnx.tips\//, '');
    slashId = slashId.replace(/\W/g, '');

    bot.startPrivateConversation(message, function(err, dm) {
      linkCollection.findOne({
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
                  printStats(stats, link.shortUrl, link.destination, link.id, 0, false, message.user, function(err, reply) {
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
            'createdDate': now.toISOString()
          };
          linkCollection.insert(record, {
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

  controller.hears(['activity'], 'direct_message,direct_mention,mention', function(bot, message) {

    var now = new Date();
    var today = new Date(now.getTime() - ONE_DAY);
    var week = new Date(now.getTime() - ONE_WEEK);
    var month = new Date(now.getTime() - ONE_MONTH);
    var topUsersText = '';

    linkCollection.find({
      'createdDate': {
        $gte: today.toISOString()
      }
    }).toArray(function(err, todayLinks) {
      linkCollection.find({
        'createdDate': {
          $gte: today.toISOString()
        }
      }).toArray(function(err, weekLinks) {
        linkCollection.find({
          'createdDate': {
            $gte: today.toISOString()
          }
        }).toArray(function(err, monthLinks) {
          linkCountGet(function(err, allLinks) {
            topCollection.findOne({
              'users': 'users'
            }, function(err, topUsers) {
              if (topUsers == null) {
                controller.log.error('Cannot find month top users in the db: ' + err);
              } else {
                for (var i = 0; i < topUsers.results.length; i++) {
                  topUsersText += '\n<@' + topUsers.results[i]._id + '> - ' + topUsers.results[i].count + ' Shortened links'
                }
              }

              var reply = {
                attachments: [],
              }
              if (todayLinks.length == 0) {
                reply.attachments.push({
                  title: "Past 24 Hours",
                  text: 'I must be putting the Slack in slacker because I haven\'t shortened *any* new links today!',
                  color: "#024DA1"
                })
              }
              if (todayLinks.length > 0) {
                var todayText = 'I\'ve shortened ' + todayLinks.length + ' new links today!'
                for (var i = 0; i < todayLinks.length; i++) {
                  todayText += '\nhttp://ntnx.tips/' + todayLinks[i].slashid + ' - Created by <@' + todayLinks[i].userid + '>'
                }
                reply.attachments.push({
                  title: "Past 24 Hours",
                  text: todayText,
                  color: "#024DA1"
                })

              }
              if (weekLinks.length == 0) {
                reply.attachments.push({
                  title: "Past Week",
                  text: 'Yeah, it\'s been a slow week. :confused:',
                  color: "#024DA1"
                })
              }
              if (weekLinks.length > 0) {
                reply.attachments.push({
                  title: "Past Week",
                  text: weekLinks.length + ' Shortened links',
                  color: "#024DA1"
                })
              }
              if (monthLinks.length == 0) {
                reply.attachments.push({
                  title: "Past Month",
                  text: 'Someone should probably tell <@matt> to stop paying the AWS bill to host me. :weary:',
                  color: "#024DA1"
                })
              }
              if (monthLinks.length > 0) {
                reply.attachments.push({
                  title: "Past Month",
                  text: monthLinks.length + ' Shortened links',
                  color: "#024DA1"
                })
              }
              reply.attachments.push({
                title: "All Time",
                text: allLinks + ' Shortened links *and counting!* :smiley:',
                color: "#024DA1"
              })
              if (topUsersText) {
                reply.attachments.push({
                  title: "Most Active Users",
                  text: topUsersText,
                  color: "#024DA1"
                })
              }
              bot.reply(message, reply)
            });
          });
        });
      });
    });
  });

  //Update global top links every 2 hours
  cron.schedule('0 */2 * * *', function() {
    updateTopLinks();
  });

  controller.hears(['force-update'], 'direct_message,direct_mention,mention', function(bot, message) {
    updateTopLinks();
  });

  controller.hears(['my top', 'my popular'], 'direct_message,direct_mention,mention', function(bot, message) {

    findUserLinks(message.user, function(err, items) {
      if (items == null) {
        bot.reply(message, '*Beep Boop!* Uh-oh, friend! Looks like I can\'t find any of your links! If you\'re sure you\'ve created some, maybe go talk to <@matt>.')
      } else {
        userStats = []

        function looper(i) {
          if (i < items.length) {
            linkGet(items[i].linkid, function(err, link) {
              if (link == null) {
                looper(i + 1);
              } else {
                statsGet(link.integration.link, function(err, stats) {
                  if (stats == null) {
                    looper(i + 1);
                  } else {
                    userStats.push({
                      'allClicks': stats.analytics.allTime.shortUrlClicks,
                      'todayClicks': stats.analytics.day.shortUrlClicks,
                      'weekClicks': stats.analytics.week.shortUrlClicks,
                      'monthClicks': stats.analytics.month.shortUrlClicks,
                      'created': stats.created,
                      'shortUrl': link.shortUrl
                    });
                    looper(i + 1);
                  }
                })

              }
            });
          } else {
            userStats.sort(sortBy('allClicks', true));
            var allTimeText = ''
            for (var i = 0; i < userStats.length && i < 10 && userStats[i].allClicks > 0; i++) {
              var created = new Date(userStats[i].created);
              allTimeText += '\nhttp://' + userStats[i].shortUrl + ' - ' + userStats[i].allClicks + ' Clicks - Created on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
            }

            userStats.sort(sortBy('todayClicks', true));
            var todayText = ''
            for (var i = 0; i < userStats.length && i < 10 && userStats[i].todayClicks > 0; i++) {
              var created = new Date(userStats[i].created);
              todayText += '\nhttp://' + userStats[i].shortUrl + ' - ' + userStats[i].todayClicks + ' Clicks - Created on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
            }

            userStats.sort(sortBy('weekClicks', true));
            var weekText = ''
            for (var i = 0; i < userStats.length && i < 10 && userStats[i].weekClicks > 0; i++) {
              var created = new Date(userStats[i].created);
              weekText += '\nhttp://' + userStats[i].shortUrl + ' - ' + userStats[i].weekClicks + ' Clicks - Created on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
            }

            userStats.sort(sortBy('monthClicks', true));
            var monthText = ''
            for (var i = 0; i < userStats.length && i < 10 && userStats[i].monthClicks > 0; i++) {
              var created = new Date(userStats[i].created);
              monthText += '\nhttp://' + userStats[i].shortUrl + ' - ' + userStats[i].monthClicks + ' Clicks - Created on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
            }

            if (allTimeText) {

              var reply = {
                text: 'Here are *your* most popular links:',
                attachments: [],
              }
              if (todayText) {
                reply.attachments.push({
                  title: "Past 24 Hours",
                  text: todayText,
                  color: "#024DA1"
                })
              }
              if (weekText) {
                reply.attachments.push({
                  title: "Past Week",
                  text: weekText,
                  color: "#024DA1"
                })
              }
              if (monthText) {
                reply.attachments.push({
                  title: "Past Month",
                  text: monthText,
                  color: "#024DA1"
                })
              }
              reply.attachments.push({
                title: "All Time",
                text: allTimeText,
                color: "#024DA1"
              })
              bot.reply(message, reply)
            } else {
              bot.reply(message, '*Beep Boop!* No one has clicked any of your links yet. If I had emotions, this would make me sad.')
            }
          }
        }
        looper(0);
      }
    });
  });

  controller.hears(['top', 'popular'], 'direct_message,direct_mention,mention', function(bot, message) {

    var allTimeText = ''
    var todayText = ''
    var weekText = ''
    var monthText = ''
    var topUsersText = ''

    topCollection.findOne({
      'time': 'allTime'
    }, function(err, topLinks) {
      if (topLinks == null) {
        controller.log.error('Cannot find allTime top links in the db: ' + err);
      } else {
        for (var i = 0; i < topLinks.links.length; i++) {
          var created = new Date(topLinks.links[i].created);
          allTimeText += '\nhttp://' + topLinks.links[i].shortUrl + ' - ' + topLinks.links[i].allClicks + ' Clicks - Created by <@' + topLinks.links[i].userid + '> on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
        }
      }

      topCollection.findOne({
        'time': 'today'
      }, function(err, topLinks) {
        if (topLinks == null) {
          controller.log.error('Cannot find today top links in the db: ' + err);
        } else {
          for (var i = 0; i < topLinks.links.length; i++) {
            var created = new Date(topLinks.links[i].created);
            todayText += '\nhttp://' + topLinks.links[i].shortUrl + ' - ' + topLinks.links[i].todayClicks + ' Clicks - Created by <@' + topLinks.links[i].userid + '> on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
          }
        }

        topCollection.findOne({
          'time': 'week'
        }, function(err, topLinks) {
          if (topLinks == null) {
            controller.log.error('Cannot find week top links in the db: ' + err);
          } else {
            for (var i = 0; i < topLinks.links.length; i++) {
              var created = new Date(topLinks.links[i].created);
              weekText += '\nhttp://' + topLinks.links[i].shortUrl + ' - ' + topLinks.links[i].weekClicks + ' Clicks - Created by <@' + topLinks.links[i].userid + '> on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
            }
          }

          topCollection.findOne({
            'time': 'month'
          }, function(err, topLinks) {
            if (topLinks == null) {
              controller.log.error('Cannot find month top links in the db: ' + err);
            } else {
              for (var i = 0; i < topLinks.links.length; i++) {
                var created = new Date(topLinks.links[i].created);
                monthText += '\nhttp://' + topLinks.links[i].shortUrl + ' - ' + topLinks.links[i].monthClicks + ' Clicks - Created by <@' + topLinks.links[i].userid + '> on ' + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
              }
            }

            if (allTimeText) {

              var reply = {
                text: 'Here are *the* most popular links:',
                attachments: [],
              }
              if (todayText) {
                reply.attachments.push({
                  title: "Past 24 Hours",
                  text: todayText,
                  color: "#024DA1"
                })
              }
              if (weekText) {
                reply.attachments.push({
                  title: "Past Week",
                  text: weekText,
                  color: "#024DA1"
                })
              }
              if (monthText) {
                reply.attachments.push({
                  title: "Past Month",
                  text: monthText,
                  color: "#024DA1"
                })
              }
              reply.attachments.push({
                title: "All Time",
                text: allTimeText,
                color: "#024DA1"
              })
              bot.reply(message, reply)
            }
          });
        });
      });
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

  function sortBy(field, reverse, primer) {

    var key = primer ?
      function(x) {
        return primer(x[field])
      } :
      function(x) {
        return x[field]
      };

    reverse = !reverse ? 1 : -1;

    return function(a, b) {
      return a = key(a), b = key(b), reverse * ((a > b) - (b > a));
    }
  }

  function printStats(stats, shorturl, destination, linkid, index, fromlist, user, callback) {

    linkCollection.findOne({
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
        var statstitle = ''

        if (user == item.userid) {
          statstitle = "All Time - Link created on " + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear()
        } else {
          statstitle = "All Time - Link created on " + monthNames[created.getMonth()] + " " + created.getDate() + ", " + created.getFullYear() + ' by <@' + item.userid + '>'
        }
        var reply = {
          text: 'Here\'s all I can tell you about http://' + shorturl,
          attachments: [{
            title: 'Destination Link',
            text: destination,
            color: "#024DA1"
          }, {
            title: statstitle,
            thumb_url: 'http://emojipedia-us.s3.amazonaws.com/cache/ea/b4/eab4395537306eaf63806710022ecc8f.png',
            text: totalText,
            color: "#024DA1"
          }],
        }
        if (stats.analytics.allTime.shortUrlClicks > 0) {
          reply.attachments.push({
            title: "Past Month",
            text: monthText,
            color: "#024DA1"
          }, {
            title: "Past Week",
            text: weekText,
            color: "#024DA1"
          }, {
            title: "Past 24 Hours",
            text: dayText,
            color: "#024DA1"
          }, {
            title: "Past 2 Hours",
            text: twoHourText,
            color: "#024DA1"
          })
        }

        if (fromlist && user == item.userid) {
          reply.attachments.push({
            title: 'Actions',
            callback_id: user,
            color: "#AFD135",
            attachment_type: 'default',
            actions: [{
              "name": "showMore",
              "text": "Return",
              "value": index + '-' + item.userid,
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
        } else if (fromlist && user !== item.userid) {
          reply.attachments.push({
            title: 'Actions',
            callback_id: user,
            color: "#AFD135",
            attachment_type: 'default',
            actions: [{
              "name": "showMore",
              "text": "Return",
              "value": index + '-' + item.userid,
              "type": "button"
            }]
          })
        } else if (user == item.userid) {
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

  function updateTopLinks() {
    var allLinks = [];

    linkCountGet(function(err, count) {
      if (count) {
        function looper(i) {
          if (i < count) {
            linkBatchGet(i, function(err, links) {
              if (links == null) {
                looper(i + 100);
              } else {
                function statsLooper(j) {
                  if (j < links.length) {
                    statsGet(links[j].integration.link, function(err, stats) {
                      if (stats == null) {
                        statsLooper(j + 1);
                      } else {
                        allLinks.push({
                          'shortUrl': links[j].shortUrl,
                          'allClicks': stats.analytics.allTime.shortUrlClicks,
                          'todayClicks': stats.analytics.day.shortUrlClicks,
                          'weekClicks': stats.analytics.week.shortUrlClicks,
                          'monthClicks': stats.analytics.month.shortUrlClicks,
                          'created': stats.created,
                          'userid': links[j].title
                        });
                        statsLooper(j + 1);
                      }
                    });
                  } else {
                    looper(i + 100);
                  }
                }
                statsLooper(0);
              }
            });
          } else {
            //Delete existing db entries for top
            topCollection.remove();

            allLinks.sort(sortBy('allClicks', true));
            var allTime = []
            for (var i = 0; i < allLinks.length && i < 10 && allLinks[i].allClicks > 0; i++) {
              allTime.push(allLinks[i]);
            }
            var record = {
              'time': 'allTime',
              'links': allTime
            }
            topCollection.insert(record, {
              w: 1
            }, function(err, result) {
              if (err) {
                controller.log.error('Failed to add allTime record to db: ' + err);
              }
            });

            allLinks.sort(sortBy('todayClicks', true));
            var today = []
            for (var i = 0; i < allLinks.length && i < 10 && allLinks[i].todayClicks > 0; i++) {
              today.push(allLinks[i]);
            }
            record = {
              'time': 'today',
              'links': today
            }
            topCollection.insert(record, {
              w: 1
            }, function(err, result) {
              if (err) {
                controller.log.error('Failed to add today record to db: ' + err);
              }
            });

            allLinks.sort(sortBy('weekClicks', true));
            var week = []
            for (var i = 0; i < allLinks.length && i < 10 && allLinks[i].weekClicks > 0; i++) {
              week.push(allLinks[i]);
            }
            record = {
              'time': 'week',
              'links': week
            }
            topCollection.insert(record, {
              w: 1
            }, function(err, result) {
              if (err) {
                controller.log.error('Failed to add week record to db: ' + err);
              }
            });

            allLinks.sort(sortBy('monthClicks', true));
            var month = []
            for (var i = 0; i < allLinks.length && i < 10 && allLinks[i].monthClicks > 0; i++) {
              month.push(allLinks[i]);
            }
            record = {
              'time': 'month',
              'links': month
            }
            topCollection.insert(record, {
              w: 1
            }, function(err, result) {
              if (err) {
                controller.log.error('Failed to add month record to db: ' + err);
              }
            });

            linkCollection.aggregate([{
              $group: {
                _id: '$userid',
                count: {
                  $sum: 1
                }
              }
            }, {
              $sort: {
                'count': -1
              }
            }], function(err, result) {
              if (err) {
                controller.log.error('Error sorting per user link counts: ' + err)
              } else {
                var users = []
                for (var i = 0; i < result.length && i < 10; i++) {
                  users.push(result[i]);
                }
                record = {
                  'users': 'users',
                  'results': users
                }
                topCollection.insert(record, {
                  w: 1
                }, function(err, result) {
                  if (err) {
                    controller.log.error('Failed to active users record to db: ' + err);
                  }
                });

              }
            });
            var now = new Date();
            console.log('Top links updated at: ' + now)
          }
        }
        looper(0);
      }
    });
  }

  function listLinks(requestingUser, user, index, callback) {
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
          text: 'I\'ve shortened *' + items.length + '* links for <@' + user + '>!\nLinks ' + begin + ' - ' + end + ':',
          attachments: [],
        }

        function looper(i) {
          if (i < linksPerPage && i + index < items.length) {
            linkGet(items[i + index].linkid, function(err, link) {
              if (link == null) {
                looper(i + 1);
              } else {

                if (requestingUser == link.title) {
                  reply.attachments.push({
                    title: link.shortUrl,
                    text: link.destination,
                    callback_id: requestingUser,
                    color: "#024DA1",
                    attachment_type: 'default',
                    actions: [{
                      "name": "stats",
                      "text": "Get Stats",
                      "value": link.integration.link + '-' + link.shortUrl + '-' + index + '-' + link.id + '-' + link.destination,
                      "type": "button",
                    }, {
                      "text": "Delete Link",
                      "name": "delete",
                      "value": index + '-' + link.id,
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
                } else {
                  reply.attachments.push({
                    title: link.shortUrl,
                    text: link.destination,
                    callback_id: requestingUser,
                    color: "#024DA1",
                    attachment_type: 'default',
                    actions: [{
                      "name": "stats",
                      "text": "Get Stats",
                      "value": link.integration.link + '-' + link.shortUrl + '-' + index + '-' + link.id + '-' + link.destination,
                      "type": "button",
                    }]
                  })
                }
                looper(i + 1);
              }
            });
          } else {
            if (i + index < items.length && i > 1 && index > 0) {
              reply.attachments.push({
                title: 'Show more links?',
                callback_id: requestingUser,
                color: "#AFD135",
                attachment_type: 'default',
                actions: [{
                  "name": "showMore",
                  "text": "Previous",
                  "value": (index - linksPerPage) + '-' + user,
                  "type": "button",
                }, {
                  "name": "showMore",
                  "text": "Next",
                  "value": (i + index) + '-' + user,
                  "type": "button",
                }]
              })
            } else if (i + index < items.length) {
              reply.attachments.push({
                title: 'Show more links?',
                callback_id: requestingUser,
                color: "#AFD135",
                attachment_type: 'default',
                actions: [{
                  "name": "showMore",
                  "text": "Next",
                  "value": (i + index) + '-' + user,
                  "type": "button",
                }]
              })
            } else if (items.length > linksPerPage) {
              reply.attachments.push({
                title: 'Show more links?',
                callback_id: requestingUser,
                color: "#AFD135",
                attachment_type: 'default',
                actions: [{
                  "name": "showMore",
                  "text": "Previous",
                  "value": (index - linksPerPage) + '-' + user,
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
    linkCollection.find({
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
        linkCollection.remove({
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

function linkBatchGet(offset, callback) {
  request({
    uri: 'https://api.rebrandly.com/v1/links?withStats=false&offset=' + offset + '&limit=100',
    method: "GET",
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.REBRANDLY_API
    }
  }, function(err, response, body) {
    if (!err && response.statusCode == 200) {
      var links = JSON.parse(body);
      callback(null, links);
    } else {
      controller.log.error('Failed to return links: ' + JSON.stringify(response));
      callback(true);
    }
  });
}

function linkCountGet(callback) {
  request({
    uri: 'https://api.rebrandly.com/v1/links/count',
    method: "GET",
    headers: {
      'Content-Type': 'application/json',
      'apikey': process.env.REBRANDLY_API
    }
  }, function(err, response, body) {
    if (!err && response.statusCode == 200) {
      var count = JSON.parse(body).count;
      callback(null, count);
    } else {
      controller.log.error('Failed to return link count: ' + JSON.stringify(response));
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