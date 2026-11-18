#!/usr/bin/env python3
"""greeting.py: hand a starting poller the set-up for its hello joke, never the same one twice in a calendar year.

  pick  [--root DIR] [--by TEXT]          choose a set-up at random from the bank below that hasn't been told this
                                          calendar year, record it, and print JSON {"stem", "year", "left", "ledgers"}.
                                          Exit 3 when the bank is used up for the year: think of one and `claim` it.
  claim STEM [--root DIR] [--by TEXT]     record a set-up of your own. Exit 0 when recorded; exit 2, with the date it
                                          was told, when it was already told this year.
  sync  [--root DIR]                      on the Mac: register DIR's ledger and copy this year's jokes into every ledger.
  list  [--root DIR] [--year N]           print JSON: the year, how many were told and the bank's size. Writes nothing.

The ledger is the record of what was told, kept in two places so each surface can see it:
- the machine's, ~/.config/agent-scaffolding/jokes-told.json (or $SCAFFOLDING_JOKES_LEDGER), used when its folder exists;
- the project's, <root>/.claude/jokes-told.json, used when --root is given and <root>/.claude exists. Cowork's VM can see
  only this one, so every poller passes --root and each pick lands in both.
The machine's ledger also lists every project ledger it has been run with. On the Mac, each command reads them all and
copies each new joke into each of them, so a joke Cowork told in one project counts everywhere, and Cowork, which sees
only its own project's ledger, still learns what Code and Codex told elsewhere. A set-up counts as told when any of them
has it this calendar year (local time). Entries from before last year are dropped on write.

Two set-ups are the same joke when they match once lower-cased and stripped of punctuation, articles and a leading
"Here's a joke:". A reworded set-up isn't caught: SKILL.md tells the agent not to dress up a told joke as a new one.

Exit 1 on a bad argument or an unwritable ledger. Writes go through a temp file and os.replace, under an flock where the
filesystem allows one. A new project ledger is added to .git/info/exclude unless git already ignores it. Vendored to
<root>/_tools/greeting.py by inbox_setup.py, for Cowork's VM. Standard library only.
"""
import argparse, contextlib, datetime, json, os, random, re, subprocess, sys

VERSION = "1.0.0"
EXIT_REPEAT, EXIT_EMPTY = 2, 3

# Well-known set-ups only: the agent supplies the technically correct, unfunny answer. Never add the two examples in
# SKILL.md (the scarecrow's award and the eyebrows), and keep every entry distinct (tests/test_greeting.py checks).
BANK = (
    # Why ...?
    "Why did the chicken cross the road?",
    "Why don't skeletons fight each other?",
    "Why was six afraid of seven?",
    "Why did the bicycle fall over?",
    "Why did the tomato turn red?",
    "Why did the cookie go to the doctor?",
    "Why did the golfer bring two pairs of trousers?",
    "Why did the maths book look so sad?",
    "Why don't scientists trust atoms?",
    "Why did the banana go to the doctor?",
    "Why do cows wear bells?",
    "Why did the teddy bear say no to dessert?",
    "Why don't eggs tell jokes?",
    "Why did the computer go to the doctor?",
    "Why did the student eat his homework?",
    "Why do bees have sticky hair?",
    "Why did the picture go to jail?",
    "Why don't oysters share their pearls?",
    "Why did the stadium get hot after the game?",
    "Why did the orange stop halfway up the hill?",
    "Why can't a nose be twelve inches long?",
    "Why did the elephant paint its toenails red?",
    "Why do fish live in salt water?",
    "Why are ghosts bad at lying?",
    "Why was the broom late?",
    "Why do seagulls fly over the sea?",
    "Why did the man run around his bed?",
    "Why don't ants get sick?",
    "Why did the fish blush?",
    "Why do birds fly south for the winter?",
    "Why did the lion spit out the clown?",
    "Why don't mummies take holidays?",
    "Why did the belt get arrested?",
    "Why are pirates called pirates?",
    "Why did the girl bring a ladder to school?",
    "Why couldn't the leopard play hide and seek?",
    "Why don't programmers like nature?",
    "Why do programmers prefer dark mode?",
    "Why did the coffee file a police report?",
    "Why did the gym close down?",
    "Why did the invisible man turn down the job offer?",
    "Why did the hipster burn his tongue?",
    "Why don't vampires go to barbecues?",
    "Why did the frog take the bus to work?",
    "Why did the drum take a nap?",
    "Why did the music teacher need a ladder?",
    "Why are frogs so happy?",
    "Why did the clock get sent to the head teacher's office?",
    "Why do elephants have trunks?",
    "Why did the cyclops close his school?",
    "Why did the moon skip dinner?",
    "Why did the bee get married?",
    "Why can't dinosaurs clap?",
    "Why do ducks have flat feet?",
    "Why was Cinderella so bad at football?",
    "Why did the robber take a bath?",
    "Why don't sharks eat clowns?",
    "Why did the turkey join the band?",
    "Why did the skeleton go to the party alone?",
    "Why did the pony have to gargle?",
    "Why couldn't the pirate play cards?",
    "Why did the dog sit in the shade?",
    "Why is Peter Pan always flying?",
    "Why did the man put his money in the freezer?",
    "Why did the melon jump into the lake?",
    "Why did the boy throw the butter out of the window?",
    "Why do hummingbirds hum?",
    "Why did the grape stop in the middle of the road?",
    "Why did the astronaut break up with her boyfriend?",
    "Why did the scientist install a knocker on his door?",
    "Why don't calendars ever win races?",
    "Why did the smartphone need glasses?",
    "Why did the barber win the race?",
    "Why was the computer cold?",
    "Why did the policeman go to the baseball game?",
    "Why did the mushroom get invited to all the parties?",
    "Why don't some couples go to the gym?",
    "Why do mathematicians confuse Halloween and Christmas?",
    "Why do Java developers wear glasses?",
    "Why did the physics teacher break up with the biology teacher?",
    "Why are chemists great at solving problems?",
    "Why did the cow go to outer space?",
    "Why did the man throw the clock out of the window?",
    "Why should you never iron a four-leaf clover?",
    "Why did the octopus beat the shark in a fight?",
    "Why don't crabs give to charity?",
    "Why did the computer squeak?",
    "Why did the cat sit on the computer?",
    "Why don't melons get married?",
    "Why did the toilet roll roll down the hill?",
    "Why do ducks make great detectives?",
    "Why did the tree go to the dentist?",
    "Why can't Monday lift Saturday?",
    "Why did the traffic light turn red?",
    "Why do gorillas have big nostrils?",
    "Why don't you see elephants hiding in trees?",
    "Why did the elephant leave the circus?",
    "Why can't you hear a pterodactyl going to the toilet?",
    "Why did the can crusher quit his job?",
    "Why are fish so clever?",
    "Why did the kitten wear a bandage?",
    "Why don't elephants use computers?",
    "Why did the sun go to school?",
    "Why was the guitar teacher arrested?",
    "Why did the archaeologist go bankrupt?",
    "Why did the football coach go to the bank?",
    "Why did the chef quit?",
    "Why don't pirates take a bath before they walk the plank?",
    "Why are mountains so funny?",
    "Why did the lettuce win the race?",
    "Why can't you play hide and seek with mountains?",
    "Why was the obtuse triangle always upset?",
    "Why did the skeleton stay out of the snow?",
    # What do you call ...?
    "What do you call a fish with no eyes?",
    "What do you call a dinosaur with an extensive vocabulary?",
    "What do you call a bear with no teeth?",
    "What do you call a cow with no legs?",
    "What do you call a man with a spade on his head?",
    "What do you call a fake noodle?",
    "What do you call a sleeping bull?",
    "What do you call cheese that isn't yours?",
    "What do you call a pig that does karate?",
    "What do you call an alligator in a vest?",
    "What do you call a boomerang that won't come back?",
    "What do you call a lazy kangaroo?",
    "What do you call a magician who has lost their magic?",
    "What do you call a belt made of watches?",
    "What do you call a dog that does magic tricks?",
    "What do you call a snowman with a six-pack?",
    "What do you call a can opener that doesn't work?",
    "What do you call an elephant that doesn't matter?",
    "What do you call a group of musical whales?",
    "What do you call a train carrying toffee?",
    "What do you call a sleeping dinosaur?",
    "What do you call a fly without wings?",
    "What do you call a man lying in a pile of leaves?",
    "What do you call a parade of rabbits hopping backwards?",
    "What do you call a nervous javelin thrower?",
    "What do you call an illegally parked frog?",
    "What do you call a cow in an earthquake?",
    "What do you call a factory that makes okay products?",
    "What do you call a pile of cats?",
    "What do you call a sad strawberry?",
    "What do you call a bee that can't make up its mind?",
    "What do you call a duck that gets all A's?",
    "What do you call an owl that does magic?",
    "What do you call a hippie's wife?",
    "What do you call two birds in love?",
    "What do you call a broken pencil?",
    "What do you call a T. rex with a sore ankle?",
    "What do you call a thieving alligator?",
    "What do you call an angry carrot?",
    "What do you call a priest who becomes a lawyer?",
    "What do you call a bee that lives in America?",
    "What do you call a fish with two knees?",
    "What do you call a pig with three eyes?",
    "What do you call a lion who has eaten your mother's sister?",
    "What do you call a donkey with three legs?",
    "What do you call a man with a seagull on his head?",
    "What do you call a crab that throws things?",
    "What do you call a man who can't stand up?",
    "What do you call a girl standing in the middle of a tennis court?",
    "What do you call a cow that has just given birth?",
    "What do you call a fish that wears a crown?",
    "What do you call a bear caught in the rain?",
    "What do you call a dinosaur that crashes his car?",
    "What do you call a camel with no humps?",
    "What do you call a rabbit with fleas?",
    "What do you call a guy with a rubber toe?",
    "What do you call an exploding monkey?",
    "What do you call a cow with a twitch?",
    "What do you call a dog in the sun?",
    "What do you call a line of men waiting for a haircut?",
    # What did ... say?
    "What did the ocean say to the beach?",
    "What did one wall say to the other wall?",
    "What did the zero say to the eight?",
    "What did the grape do when it got stepped on?",
    "What did the left eye say to the right eye?",
    "What did the buffalo say to his son when he left for university?",
    "What did the big flower say to the little flower?",
    "What did the fish say when it swam into a wall?",
    "What did one plate say to the other plate?",
    "What did the hat say to the scarf?",
    "What did the policeman say to his belly button?",
    "What did the cleaner say when he jumped out of the cupboard?",
    "What did the pirate say on his eightieth birthday?",
    "What did the cheese say when it looked in the mirror?",
    "What did the triangle say to the circle?",
    "What did one volcano say to the other?",
    "What did the duck say when it bought lipstick?",
    "What did the sushi say to the bee?",
    "What did one snowman say to the other snowman?",
    "What did the tree say to the wind?",
    "What did the mother broom say to the baby broom?",
    "What did one toilet say to the other?",
    "What did the paper say to the pencil?",
    "What did the boy candle say to the girl candle?",
    "What did the thermometer say to the measuring cylinder?",
    "What did the traffic light say to the car?",
    "What did the drummer call his twin daughters?",
    "What did Tarzan say when he saw the elephants coming?",
    "What did the cat say when it lost all its money?",
    "What did the dog say when it sat on sandpaper?",
    "What did the blanket say when it fell off the bed?",
    "What did the femur say to the patella?",
    "What did the digital clock say to the grandfather clock?",
    "What did the baby corn say to the mummy corn?",
    "What did the judge say when the skunk walked into court?",
    # What's ...? and riddles
    "What's brown and sticky?",
    "What's orange and sounds like a parrot?",
    "What's green and has wheels?",
    "What's black and white and red all over?",
    "What's the best thing about Switzerland?",
    "What's red and bad for your teeth?",
    "What's the difference between a hippo and a Zippo?",
    "What's the difference between a piano and a fish?",
    "What's the difference between a cat and a comma?",
    "What's the difference between ignorance and apathy?",
    "What's the difference between a duck?",
    "What's an astronaut's favourite part of a computer?",
    "What's a pirate's favourite letter?",
    "What's a ghost's favourite fruit?",
    "What's a skeleton's favourite instrument?",
    "What's a vampire's favourite fruit?",
    "What's the loudest pet you can get?",
    "What's the fastest way to make a sausage roll?",
    "What's yellow and can't swim?",
    "What's grey and comes in pints?",
    "What's big, red and eats rocks?",
    "What's brown and sounds like a bell?",
    "What's grey and goes round and round?",
    "What's the best time to go to the dentist?",
    "What's the internal temperature of a teapot?",
    "What's a cat's favourite colour?",
    "What's a tornado's favourite game?",
    "What's the smartest insect?",
    "What's the coldest country in the world?",
    "What has four wheels and flies?",
    "What has a head and a tail but no body?",
    "What has keys but can't open locks?",
    "What gets wetter the more it dries?",
    "What has hands but can't clap?",
    "What can you catch but not throw?",
    "What goes up but never comes down?",
    "What has one eye but can't see?",
    "What has a neck but no head?",
    "What has teeth but can't bite?",
    "What runs but never walks?",
    "What is full of holes but still holds water?",
    "What goes \"ha ha bonk\"?",
    "What kind of tree fits in your hand?",
    "What kind of shoes do ninjas wear?",
    "What kind of music do mummies like?",
    "What kind of key opens a banana?",
    "What kind of dog does a magician have?",
    "What kind of room has no doors or windows?",
    "What do you get if you cross a sheep with a kangaroo?",
    "What do you get when you cross a snowman with a vampire?",
    "What do you get if you cross a cow with a trampoline?",
    "What do you get when you cross a dog with a calculator?",
    "What do you get if you cross an elephant with a fish?",
    "What do you get if you put a duck in a cement mixer?",
    "What do you get when you cross a joke with a rhetorical question?",
    "What do you get if you cross a centipede with a parrot?",
    "What do you get if you cross a pig with a dinosaur?",
    "What do you get if you cross a frog with a rabbit?",
    "What do you get when you cross a fish with an elephant's trunk?",
    "What do elves learn in school?",
    "What do sea monsters eat?",
    "What do you give a sick lemon?",
    "What do clouds wear under their shorts?",
    "What do lawyers wear to court?",
    "What do you do with a dead chemist?",
    "What do you call it when a cat wins a dog show?",
    "What happens when a frog's car breaks down?",
    "What happened to the man who stole a calendar?",
    "What happened when the cow jumped over the barbed-wire fence?",
    "What happens if you eat yeast and shoe polish?",
    # How ...?
    "How many surrealists does it take to change a light bulb?",
    "How many programmers does it take to change a light bulb?",
    "How many tickles does it take to make an octopus laugh?",
    "How do you make a tissue dance?",
    "How do you organise a space party?",
    "How does a penguin build its house?",
    "How do you catch a squirrel?",
    "How do you count cows?",
    "How does the moon cut his hair?",
    "How do you make a Swiss roll?",
    "How do you make holy water?",
    "How do you keep a bagel from getting away?",
    "How do you stop a bull from charging?",
    "How does a train eat?",
    "How do you make an egg roll?",
    "How many ears does Mr Spock have?",
    "How do you start a teddy bear race?",
    "How do you stop an astronaut's baby from crying?",
    "How do you fix a broken tomato?",
    "How do you throw a party on Mars?",
    "How does a cucumber become a pickle?",
    "How do you get four elephants into a Mini?",
    "How do you know an elephant has been in your fridge?",
    "How do you make a bandstand?",
    "How do you get a baby astronaut to sleep?",
    "How do you weigh a whale?",
    "How do you fit more pigs on a farm?",
    "How does a scientist freshen her breath?",
    "How do bees get to school?",
    # Where, which, when, who
    "Where do cows go on holiday?",
    "Where do polar bears vote?",
    "Where does a general keep his armies?",
    "Where do fish keep their money?",
    "Where do pencils go on holiday?",
    "Where do sheep get their hair cut?",
    "Where do snowmen keep their money?",
    "Where do kittens learn to swim?",
    "Where do you learn to make ice cream?",
    "Where do bees go to the toilet?",
    "Which side of a duck has the most feathers?",
    "Which is heavier, a ton of bricks or a ton of feathers?",
    "Which month has 28 days?",
    "Which hand is it better to write with?",
    "When is a door not a door?",
    "When does a joke become a dad joke?",
    "Who's the coolest person in the hospital?",
    "Who invented the round table?",
    "Who keeps the ocean clean?",
    # Knock knock
    "Knock knock. Who's there? Lettuce. Lettuce who?",
    "Knock knock. Who's there? Boo. Boo who?",
    "Knock knock. Who's there? Interrupting cow. Interrupting cow wh-",
    "Knock knock. Who's there? Cow says. Cow says who?",
    "Knock knock. Who's there? Doctor. Doctor who?",
    "Knock knock. Who's there? Tank. Tank who?",
    "Knock knock. Who's there? Atch. Atch who?",
    "Knock knock. Who's there? Olive. Olive who?",
    "Knock knock. Who's there? Nana. Nana who?",
    "Knock knock. Who's there? Orange. Orange who?",
    "Knock knock. Who's there? Broken pencil. Broken pencil who?",
    "Knock knock. Who's there? Owls say. Owls say who?",
    "Knock knock. Who's there? Spell. Spell who?",
    "Knock knock. Who's there? Wooden shoe. Wooden shoe who?",
    "Knock knock. Who's there? Justin. Justin who?",
    "Knock knock. Who's there? Europe. Europe who?",
    "Knock knock. Who's there? Little old lady. Little old lady who?",
    "Knock knock. Who's there? Dishes. Dishes who?",
    "Knock knock. Who's there? Harry. Harry who?",
    "Knock knock. Who's there? Ice cream. Ice cream who?",
    "Knock knock. Who's there? Alpaca. Alpaca who?",
    "Knock knock. Who's there? Cash. Cash who?",
    "Knock knock. Who's there? Woo. Woo who?",
    "Knock knock. Who's there? Yah. Yah who?",
    # Doctor, doctor
    "Doctor, doctor, I feel like a pair of curtains.",
    "Doctor, doctor, I keep thinking I'm a pack of cards.",
    "Doctor, doctor, I think I'm invisible.",
    "Doctor, doctor, I feel like a dog.",
    "Doctor, doctor, I've got a strawberry stuck in my ear.",
    "Doctor, doctor, I think I'm a moth.",
    "Doctor, doctor, I keep thinking I'm a bridge.",
    "Doctor, doctor, I think I'm shrinking.",
    "Doctor, doctor, everyone keeps ignoring me.",
    "Doctor, doctor, one night I dream I'm a wigwam and the next I'm a teepee.",
    "Doctor, doctor, I think I'm a bell.",
    "Doctor, doctor, will I be able to play the violin after the operation?",
    "Doctor, doctor, I keep seeing spots before my eyes.",
    "Doctor, doctor, I've swallowed a roll of film.",
    "Doctor, doctor, I think I'm a pair of trousers.",
    "Doctor, doctor, I feel like a sheep.",
    "Doctor, doctor, I keep thinking I'm a dustbin.",
    "Doctor, doctor, I've lost my memory.",
    # Walks into a bar, and other pairs
    "A horse walks into a bar, and the barman asks, \"Why the long face?\"",
    "A man walks into a bar.",
    "A sandwich walks into a bar, and the barman says, \"Sorry, we don't serve food here.\"",
    "A skeleton walks into a bar and orders a pint and a mop.",
    "A neutron walks into a bar and asks how much for a drink.",
    "A grasshopper walks into a bar, and the barman says, \"We've got a drink named after you.\"",
    "A priest, a rabbi and a vicar walk into a bar.",
    "A duck walks into a bar and asks the barman, \"Got any grapes?\"",
    "A piece of string walks into a bar.",
    "A termite walks into a pub and asks, \"Is the bar tender here?\"",
    "A jump lead walks into a bar.",
    "A Roman legionary walks into a bar, holds up two fingers and says, \"Five beers, please.\"",
    "An SQL query walks into a bar, goes up to two tables and asks, \"Can I join you?\"",
    "Schrodinger's cat walks into a bar.",
    "An infinite number of mathematicians walk into a bar.",
    "A photon checks into a hotel and the porter asks if it has any luggage.",
    "Heisenberg is pulled over for speeding, and the officer asks, \"Do you know how fast you were going?\"",
    "Pavlov is sitting in a pub when the phone rings.",
    "A man walks into a library and asks for a book on paranoia.",
    "A programmer's wife says, \"Get a loaf of bread, and if they have eggs, get a dozen.\"",
    "Two fish are in a tank, and one says to the other...",
    "Two cannibals are eating a clown, and one says to the other...",
    "Two muffins are in an oven, and one says to the other...",
    "Two aerials meet on a roof, fall in love and get married.",
    "Two cows are in a field. One says, \"Moo.\" The other says...",
    "Two peanuts were walking down the road.",
    "Two snowmen are standing in a field.",
    "Two drums and a cymbal fall off a cliff.",
    "There are 10 kinds of people in the world.",
    "Time flies like an arrow.",
    # I ... (first person: the answer may point out you're an agent)
    "I'm reading a book on anti-gravity.",
    "I used to be addicted to soap.",
    "I haven't slept for ten days.",
    "I bought some shoes from a drug dealer.",
    "I'm on a seafood diet.",
    "I tried to catch some fog.",
    "I used to play piano by ear.",
    "I went to buy some camouflage trousers, but I couldn't find any.",
    "I wondered why the frisbee was getting bigger.",
    "I've just written a song about tortillas.",
    "I'm terrified of lifts, so I'm taking steps to avoid them.",
    "I don't trust stairs.",
    "My dog has no nose.",
    "My wife told me to stop impersonating a flamingo.",
    "My grandfather has the heart of a lion.",
    "I bought a ceiling fan the other day.",
    "I got fired from the calendar factory.",
    "I'd tell you a joke about construction, but I'm still working on it.",
    "I'd tell you a UDP joke, but you might not get it.",
    "I'd tell you a chemistry joke, but I know I wouldn't get a reaction.",
    "I'd tell you a joke about time travel, but you didn't like it.",
    "I'd tell you a joke about pizza, but it's a bit cheesy.",
    "I'd tell you a joke about paper, but it's tearable.",
    "I'd tell you a joke about a lift, but it works on so many levels.",
    "I'm friends with all electricians.",
    "I went to the zoo and there was only one dog in it.",
    "I couldn't work out how the seat belt worked.",
    "I lost my job at the bank on my first day.",
    "I used to work in a shoe-recycling shop.",
    "I asked my dog what two minus two is.",
    "I gave all my dead batteries away today.",
    "I told my computer I needed a break.",
    "A friend of mine tried to annoy me with bird puns.",
    "Last night I dreamt I was a muffler.",
    "Last night I dreamt I was eating a giant marshmallow.",
    "My friend's bakery burned down last night.",
    "I've been trying to write a joke about the sea, but I'm getting nowhere.",
    "I asked a Frenchman if he played video games.",
    "I bought my friend an elephant for his room.",
    "I'm reading a book about mazes.",
    "I used to hate facial hair.",
    "I'm so good at sleeping that I can do it with my eyes closed.",
    "I tried to sue the airline for losing my luggage.",
    "I wanted to be a tightrope walker.",
    # Did you hear ...? / Dad, ...
    "Dad, can you put my shoes on?",
    "Dad, I'm hungry.",
    "Did you hear about the restaurant on the moon?",
    "Did you hear about the claustrophobic astronaut?",
    "Did you hear about the man who fell into an upholstery machine?",
    "Did you hear about the kidnapping at school?",
    "Did you hear about the cheese factory that exploded in France?",
    "Did you hear about the man who invented the knock-knock joke?",
    "Did you hear about the actor who fell through the floorboards?",
    "Did you hear about the mathematician who's afraid of negative numbers?",
    "Did you hear about the circus fire?",
    "Did you hear about the new corduroy pillows?",
    "Did you hear the one about the roof?",
    "Did you hear about the Italian chef who died?",
    "Did you hear about the hungry clock?",
    "Did you hear about the man who lost the left side of his body?",
    "Did you hear oxygen and magnesium got together?",
    "Have you heard the joke about the butter?",
    "Have you heard about the new film about clocks?",
    # Waiter, and the rest
    "Waiter, there's a fly in my soup.",
    "Waiter, this coffee tastes like mud.",
    "Waiter, will my pizza be long?",
    "Waiter, do you serve crabs?",
    "Is your refrigerator running?",
    "Can February march?",
    "Never trust a dog to watch your food.",
)


def norm(text):
    """Lower case, punctuation and quotes dropped, spaces collapsed, any "Here's a joke:" lead-in removed."""
    t = re.sub(r"[^\w\s]", " ", text.lower().replace("’", "'").replace("'", ""))
    t = re.sub(r"^heres a joke\s+", "", " ".join(t.split()))
    return " ".join(w for w in t.split() if w not in ("a", "an", "the"))


def same(a, b):
    return norm(a) == norm(b)


def machine_ledger():
    env = os.environ.get("SCAFFOLDING_JOKES_LEDGER")
    if env:
        return env if os.path.isdir(os.path.dirname(os.path.abspath(env))) else None
    folder = os.path.expanduser("~/.config/agent-scaffolding")
    return os.path.join(folder, "jokes-told.json") if os.path.isdir(folder) else None


def project_ledger(root):
    return os.path.join(root, ".claude", "jokes-told.json") if root and os.path.isdir(os.path.join(root, ".claude")) else None


def load(path):
    """(told, projects) from a ledger; a missing or bad file is empty."""
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return [], []
    if not isinstance(data, dict):
        return [], []
    told = [t for t in data.get("told", []) if isinstance(t, dict) and isinstance(t.get("stem"), str)
            and isinstance(t.get("year"), int)]
    projects = [p for p in data.get("projects", []) if isinstance(p, str)]
    return told, projects


def save(path, told, projects, year):
    keep = [t for t in told if t["year"] >= year - 1]
    data = {"version": 1, "told": keep}
    if projects:
        data["projects"] = sorted(set(projects))
    text = json.dumps(data, indent=1, ensure_ascii=False) + "\n"
    tmp = f"{path}.{os.getpid()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, path)
    except OSError:
        with open(path, "w", encoding="utf-8") as f:   # a mount that refuses the rename
            f.write(text)


@contextlib.contextmanager
def locked(path):
    """flock on <path>.lock for the block, where the filesystem allows one; a mount that refuses locks goes without.
    Take it once per ledger per command: a second flock on a new handle in the same process would wait on the first."""
    f = None
    if path:
        try:
            import fcntl
            f = open(path + ".lock", "a")
            fcntl.flock(f, fcntl.LOCK_EX)
        except (ImportError, OSError):
            if f:
                f.close()
            f = None
    try:
        yield
    finally:
        if f:
            f.close()


class Ledgers:
    """The ledgers this command writes (the machine's and this project's) and reads (those, plus every project ledger
    the machine's has seen, so a joke Cowork told in one project counts in all of them)."""

    def __init__(self, root):
        self.machine, self.project = machine_ledger(), project_ledger(root)
        self.write = [p for p in (self.machine, self.project) if p]

    def told(self, year):
        seen = []
        for p in dict.fromkeys(self.write + self.known()):
            seen += [t for t in load(p)[0] if t["year"] == year]
        return seen

    def known(self):
        return [p for p in (load(self.machine)[1] if self.machine else []) if p != self.project]

    def record(self, entries, year):
        """Merge this year's entries into this command's ledgers (locks held by the caller), then into the other known
        project ledgers, best effort, each under its own lock. Every ledger ends up with the whole year's jokes."""
        for p in self.write:
            add(p, entries, year, [self.project] if p == self.machine and self.project else [])
        for p in self.known():
            if os.path.isdir(os.path.dirname(p)):
                try:
                    with locked(p):
                        add(p, entries, year, [])
                except OSError:
                    pass


def add(path, entries, year, projects):
    new = not os.path.exists(path)
    told, have = load(path)
    for e in entries:
        if not any(t["year"] == year and same(t["stem"], e["stem"]) for t in told):
            told = told + [e]
    save(path, told, have + projects, year)
    if new and os.path.basename(os.path.dirname(path)) == ".claude":
        keep_out_of_git(os.path.dirname(os.path.dirname(path)))


def keep_out_of_git(root):
    """Add the ledger and its lock to the repository's .git/info/exclude when git doesn't already ignore them."""
    rel = ".claude/jokes-told.json"
    try:
        r = subprocess.run(["git", "--no-optional-locks", "-C", root, "check-ignore", "-q", rel], capture_output=True)
        if r.returncode != 1:          # 0: already ignored; 128: not a repository, or no git
            return
        r = subprocess.run(["git", "--no-optional-locks", "-C", root, "rev-parse", "--git-path", "info/exclude"],
                           capture_output=True, text=True)
        if r.returncode:
            return
        path = os.path.join(root, r.stdout.strip())
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"\n{rel}\n{rel}.lock\n")
    except OSError:
        pass


def now():
    return datetime.datetime.now().astimezone()


def entry_for(stem, by, when):
    e = {"stem": stem, "year": when.year, "at": when.isoformat(timespec="seconds")}
    if by:
        e["by"] = by
    return e


def unused(seen):
    told = {norm(t["stem"]) for t in seen}
    return [s for s in BANK if norm(s) not in told]


def cmd_pick(a):
    led, when = Ledgers(a.root), now()
    if not led.write:
        print("warning: no ledger here (no ~/.config/agent-scaffolding and no <root>/.claude), so repeats can't be "
              "prevented", file=sys.stderr)
    with locked(led.machine), locked(led.project):   # two pollers starting together don't draw the same set-up
        seen = led.told(when.year)
        left = unused(seen)
        if not left:
            print(json.dumps({"stem": None, "year": when.year, "left": 0, "ledgers": led.write}))
            print(f"the bank of {len(BANK)} set-ups is used up for {when.year}: think of another well-known one and "
                  "record it with `claim`", file=sys.stderr)
            return EXIT_EMPTY
        stem = random.SystemRandom().choice(left)
        led.record(seen + [entry_for(stem, a.by, when)], when.year)
    print(json.dumps({"stem": stem, "year": when.year, "left": len(left) - 1, "ledgers": led.write}, ensure_ascii=False))
    return 0


def cmd_claim(a):
    led, when, stem = Ledgers(a.root), now(), a.stem.strip()
    if not norm(stem):
        print("ERROR: empty set-up", file=sys.stderr)
        return 1
    with locked(led.machine), locked(led.project):
        seen = led.told(when.year)
        for t in seen:
            if same(stem, t["stem"]):
                print(json.dumps({"recorded": False, "stem": t["stem"], "told_at": t.get("at")}, ensure_ascii=False))
                print(f"already told in {when.year}: {t['stem']!r} on {str(t.get('at', '?'))[:10]}; pick another",
                      file=sys.stderr)
                return EXIT_REPEAT
        led.record(seen + [entry_for(stem, a.by, when)], when.year)
    print(json.dumps({"recorded": bool(led.write), "stem": stem, "year": when.year, "ledgers": led.write},
                     ensure_ascii=False))
    return 0


def cmd_sync(a):
    led, when = Ledgers(a.root), now()
    with locked(led.machine), locked(led.project):
        seen = led.told(when.year)
        if led.write:
            led.record(seen, when.year)
    print(json.dumps({"year": when.year, "told": len({norm(t["stem"]) for t in seen}), "ledgers": led.write,
                      "projects": led.known() + ([led.project] if led.project else [])}))
    return 0


def cmd_list(a):
    led = Ledgers(a.root)
    year = a.year or now().year
    seen = led.told(year)
    print(json.dumps({"year": year, "told": len({norm(t["stem"]) for t in seen}), "bank": len(BANK),
                      "bank_left": len(unused(seen)), "ledgers": led.write}))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description="Set-ups for the poller's hello joke, no repeats in a calendar year.")
    ap.add_argument("--version", action="version", version=VERSION)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("pick", "claim", "sync", "list"):
        p = sub.add_parser(name)
        p.add_argument("--root", help="project folder, for its .claude/jokes-told.json")
        if name == "claim":
            p.add_argument("stem", help="the set-up, as you'll tell it")
        if name in ("pick", "claim"):
            p.add_argument("--by", help="who told it, e.g. 'Code poller, trailblazer'")
        if name == "list":
            p.add_argument("--year", type=int)
    a = ap.parse_args(argv)
    try:
        return {"pick": cmd_pick, "claim": cmd_claim, "sync": cmd_sync, "list": cmd_list}[a.cmd](a)
    except OSError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
