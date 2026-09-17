# Start here

This starts a program that watches your Walmart Seller Center pages for you.

It is **not** a website you open. It is a program that opens its own browser
window, clicks through your seven Seller Center pages over and over, and tells
you if one of them breaks.

---

## Step 1 — Get the files onto your computer

Download the project as a ZIP from GitHub and unzip it:

https://github.com/amc365/WALMART/archive/refs/heads/claude/blissful-hypatia-378pfl.zip

You'll get a folder. Open it.

## Step 2 — Double-click one file

- **On a Mac:** double-click `start-mac.command`
- **On Windows:** double-click `start-windows.bat`

A black text window opens. That window is the program. **Leave it open.**

The very first time, it spends a few minutes installing what it needs. That's
normal and only happens once.

> Mac may say *"cannot be opened because it is from an unidentified developer."*
> Right-click `start-mac.command` instead, choose **Open**, then **Open** again.

## Step 3 — Sign in, once

A browser window opens showing the Walmart sign-in page. Sign in the way you
normally do, including any code Walmart texts you.

Once you're in, the window closes by itself and the watching begins. **You only
do this once** — it remembers you next time.

## You will see it working

A browser window opens and moves through your Seller Center pages on its own.
That is the program doing its job — let it be. Don't type in it or close it.

**It does not control your mouse or keyboard.** It drives its own separate
browser with its own invisible pointer. Your mouse, and your own Chrome windows,
carry on as normal — keep working while it runs.

To hide that window instead, open the start file in Notepad and delete the word
`--headed` from the last command.

## Step 4 — That's it

The black window fills with lines like this, one per page it checks:

```
11:00:29  Dashboard     OK    737ms
11:00:30  Orders        OK    740ms
11:00:31  Items         OK    741ms
```

`OK` means the page loaded fine. It goes round and round for 8 hours.

**If something breaks, it stops and says so in plain terms:**

```
========================================================================
MONITORING STOPPED — a section is not healthy
========================================================================
  Section : Payments
  Problem : access
  Error   : HTTP 403 — account lacks access or the session was rejected
========================================================================
```

That tells you which page broke and what went wrong. It also saves a
screenshot of the broken page in `monitor/logs/failures/` so you can see
exactly what it saw.

---

## Answers to what usually goes wrong

**"Nothing happens when I double-click."**
Node.js isn't installed. The window will say so and point you to
https://nodejs.org — install the LTS version, then double-click again.

**"It said `Failed to install browsers` / `Download failure`."**
Harmless. That's the optional 150 MB browser download being cut off by your
connection. It now carries on and uses Microsoft Edge, which is already on your
PC. If it still can't start, it will say `CANNOT START — no browser to drive`,
and installing Google Chrome fixes it.

**"It stopped and said `login`."**
Your Walmart session expired — normal after enough hours. Double-click the
start file again and sign in once more.

**"Can I close the black window?"**
Only if you want it to stop. Closing it stops the watching. Your computer also
has to stay awake — if it sleeps, the program pauses with it.

**"I want it to watch for longer than 8 hours."**
Open the start file in a text editor and change `--hours=8` to what you want.

**"Nothing is being watched right now, is it?"**
Correct. Nothing is running anywhere until you do Step 2 on your own computer.

---

## For the technically inclined

`monitor/README.md` has the flags, the failure categories, the log formats,
and `npm run monitor:selftest`, which verifies the checks against a mock
Seller Center without touching a real account.
