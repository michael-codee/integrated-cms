# Test the CMIS in GitHub Codespaces

This codespace runs the whole system (database, API and app) with **made-up demo data**,
for testing and demonstrations only. Never enter real church records here.

## First start

The system builds and starts by itself; the first start takes about 5 minutes.
When it is ready, the terminal shows a box like this:

```
================ CMIS test system is running ================
Address:  https://<your-codespace>-80.app.github.dev
Username: testadmin
Password: Test-…
```

Open the address (or the **Ports** tab → port 80 → globe icon) and sign in.
The password is random for your codespace and is also saved in `.devcontainer/test-login.txt`.

## Everyday use

- The codespace stops after 30 minutes without use and keeps its data. Reopen it from
  **Code → Codespaces** on GitHub; the system starts again automatically.
- To show it to someone: **Ports** tab → right-click port 80 → **Port visibility → Public**.
  Switch it back to **Private** afterwards.
- Show the login again: `cat .devcontainer/test-login.txt`
- Restart the system: `bash .devcontainer/start.sh`
- Start over with fresh demo data: `docker compose down -v && rm -f .env .devcontainer/test-login.txt && bash .devcontainer/start.sh`

Free GitHub accounts include about 60 hours of codespace use per month. Delete the
codespace from **github.com/codespaces** when you have finished testing.
