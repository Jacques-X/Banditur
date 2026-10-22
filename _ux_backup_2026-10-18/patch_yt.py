p='src-tauri/src/ytmp3.rs'
s=open(p,encoding='utf8').read()
miss=[]
def rep(a,b):
    global s
    if s.count(a)!=1: miss.append(a[:60]); return
    s=s.replace(a,b)

# 1. helpers
rep("// ── Download command ──────────────────────────────────────────────────────────",
'''/// YouTube now needs a JavaScript runtime for most videos. yt-dlp only looks for Deno on the PATH,
/// and an app started from the Dock has a very short PATH, so hand it the runtime explicitly
/// (only when this yt-dlp version knows the option).
async fn js_runtime_args(ytdlp: &str) -> Vec<String> {
    use tokio::process::Command;
    let supports = match Command::new(ytdlp).arg("--help").output().await {
        Ok(out) => String::from_utf8_lossy(&out.stdout).contains("--js-runtimes"),
        Err(_) => false,
    };
    if !supports {
        return vec![];
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        ("deno", "/opt/homebrew/bin/deno".to_string()),
        ("deno", "/usr/local/bin/deno".to_string()),
        ("deno", format!("{home}/.deno/bin/deno")),
        ("node", "/opt/homebrew/bin/node".to_string()),
        ("node", "/usr/local/bin/node".to_string()),
    ];
    for (name, path) in candidates {
        if std::path::Path::new(&path).exists() {
            return vec!["--js-runtimes".into(), format!("{name}:{path}")];
        }
    }
    vec![]
}

/// Turn yt-dlp's raw error output into a short Maltese sentence that says what to do,
/// followed by the original last error line in brackets.
fn explain_ytdlp_error(stderr: &str) -> String {
    let raw = stderr
        .lines()
        .rev()
        .find(|l| l.contains("ERROR"))
        .or_else(|| stderr.trim().lines().last())
        .unwrap_or("yt-dlp falla.")
        .trim()
        .to_string();
    let l = stderr.to_lowercase();
    let hint = if l.contains("sign in to confirm") || l.contains("not a bot") {
        "YouTube qed jitlob sign-in. Aġġorna yt-dlp (brew upgrade yt-dlp) u erġa' pprova; jekk jibqa', il-video jista' jkun ristrett."
    } else if l.contains("javascript runtime")
        || l.contains("n challenge")
        || l.contains("nsig")
        || l.contains("only images are available")
        || l.contains("requested format is not available")
    {
        "YouTube jeħtieġ JavaScript runtime. Installa Deno (brew install deno) u aġġorna yt-dlp (brew upgrade yt-dlp)."
    } else if l.contains("private video") || l.contains("video unavailable") || l.contains("members-only") {
        "Il-video mhux disponibbli (privat, mneħħi jew għall-membri biss)."
    } else if l.contains("unable to download") || l.contains("getaddrinfo") || l.contains("network is unreachable") {
        "Ma setax jikkonnettja ma' YouTube. Iċċekkja l-internet."
    } else if l.contains("unable to extract") || l.contains("http error 403") || l.contains("http error 400") {
        "yt-dlp huwa antik għal YouTube. Aġġorna: brew upgrade yt-dlp (jew python3 -m pip install -U yt-dlp)."
    } else {
        return raw;
    };
    format!("{hint} [{raw}]")
}

// ── Download command ──────────────────────────────────────────────────────────''')

# 2. pass the runtime option
rep('''    if let Some(ff) = find_ffmpeg().await {
        args.push("--ffmpeg-location".into());
        args.push(ff);
    }
''','''    if let Some(ff) = find_ffmpeg().await {
        args.push("--ffmpeg-location".into());
        args.push(ff);
    }
    args.extend(js_runtime_args(&ytdlp).await);
''')

# 3. readable error
rep('''        let msg = if !stderr_output.trim().is_empty() {
            stderr_output
                .trim()
                .lines()
                .last()
                .unwrap_or("yt-dlp falla.")
                .to_string()
        } else {''','''        let msg = if !stderr_output.trim().is_empty() {
            explain_ytdlp_error(&stderr_output)
        } else {''')
open(p,'w',encoding='utf8').write(s)
print('misses',miss)
