# 
# Make github flow actions faster


• It took about 100 minutes from creating the draft to confirming that existing
Sparkle clients could see 6.2.1. Most of that was a cold macOS build, compounded
by one avoidable failed attempt.

 Phase                                      Time    Why
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 Reuse and verify both gxserver assets    ~7 min    Downloaded, hashed, and re-
                                                    uploaded sequentially
───────────────────────────────────────  ────────  ───────────────────────────────
 First macOS attempt                      19 min    Failed because VS Code
                                                    extension downloads lacked
                                                    GITHUB_TOKEN; now fixed
───────────────────────────────────────  ────────  ───────────────────────────────
 Successful macOS workflow                61 min    Fresh runner rebuilt nearly
                                                    everything
───────────────────────────────────────  ────────  ───────────────────────────────
 Assembly and publication                 ~2 min    Validation, release
                                                    publication, Sparkle commit
───────────────────────────────────────  ────────  ───────────────────────────────
 Sparkle CDN propagation                  ~6 min    raw.githubusercontent.com
                                                    retained the previous appcast
                                                    for its cache window

Inside the successful macOS workflow:

- Environment and dependencies: ~8 minutes.
- GhosttyKit: ~6 minutes.
- Rust helper binaries: ~3 minutes.
- VS Code/code-server payload: ~8 minutes.
- Bundled macOS gxserver: ~3 minutes.
- T3 Code runtime: ~2 minutes.
- Main GPUI Rust build: ~12 minutes.
- Signing, packaging, notarization, stapling, and staging: ~10 minutes.

The remote Linux gxserver packages were not rebuilt. However, the app’s bundled
macOS gxserver helper was still compiled because the macOS packaging job currently
rebuilds every local runtime component.

The fundamental problem is that macos-15 provides a new 3-core M1 VM with only 7
GB RAM for every job. Nothing from the previous release survives unless we
explicitly cache or publish it. GitHub’s runner specifications
(https://docs.github.com/en/actions/reference/runners/github-hosted-runners)

What I recommend, in order:

1. Add trusted build caches.

   Cache Cargo registries and targets, Zig caches, GhosttyKit, CEF, the prepared
   code-server/T3 runtime, and build/arm64/build-cache. Cache keys should include
   the exact source inputs, toolchain versions, architecture, and lockfiles.
   Release jobs should restore only caches created by trusted main builds. GitHub
   supports exact-key and partial-key dependency caching for this. GitHub
   dependency caching
   (https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)

2. Prebuild heavyweight runtime components on every trusted main push.

   Produce checksum-verified artifacts for:
    - GhosttyKit and native helpers
    - VS Code/code-server and T3 Code
    - GPUI and bundled Rust binaries

   A release would download the artifact for its exact source SHA, assemble the
   app, sign it, and notarize it. This moves most compilation before the release
   is requested and also exposes build failures earlier.

3. Run independent builds in parallel.

   GhosttyKit, VS Code/T3, and Rust compilation do not all need to occupy one
   sequential 43-minute step. Separate jobs can build them concurrently, followed
   by one macOS assembly/signing job.

4. Automate the end of the pipeline.

   Once the macOS package finishes, assembly should dispatch automatically. Both
   reused gxserver assets should also be copied and verified in parallel. This
   removes agent polling and several minutes of orchestration latency.

5. Replace the raw GitHub Sparkle endpoint eventually.

   Future Ghostex builds should use something like
   updates.ghostex.app/appcast.xml, published atomically with controlled cache
   headers and purge support. We would continue updating the current raw feed for
   older app versions.

6. Optionally use GitHub’s larger M2 runner.

   GitHub offers a 5-core M2 Pro runner under macos-15-xlarge, compared with the
   current 3-core M1. It costs $0.102/minute, requires an eligible organization
   plan, and will help compilation—but caching will provide the bigger
   improvement. Larger runner specifications
   (https://docs.github.com/en/actions/reference/runners/larger-runners), runner
   pricing (https://docs.github.com/en/billing/reference/actions-runner-pricing)

I would avoid a persistent self-hosted Mac for this public repository unless it is
tightly isolated and can run only protected release workflows. GitHub explicitly
warns that public-repository self-hosted runners can be compromised through
untrusted workflow code. GitHub secure-use guidance
(https://docs.github.com/en/actions/reference/security/secure-use)

With the failures already fixed, another completely cold release should be closer
to 65–75 minutes. With trusted caches and prebuilt runtime artifacts, a routine
macOS release should realistically reach GitHub in roughly 15–25 minutes, plus up
to five minutes for the current Sparkle CDN.

Summary: The release was slow because GitHub rebuilt the entire macOS runtime from
a cold VM and the first build failed; trusted caches, prebuilt artifacts, and
parallel jobs should reduce routine releases to about 20–30 minutes end-to-end.

