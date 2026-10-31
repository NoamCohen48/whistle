# Whistle built from source: the same standalone executable as the release downloads.
# Used by flake.nix; see docs/packaging.md.
{
  lib,
  stdenv,
  stdenvNoCC,
  bun,
  autoPatchelfHook,
  revision ? "unknown",
}:

let
  root = ../..;
  pkg = lib.importJSON (root + "/package.json");
  # Native parts of the Vite build for this machine; every other platform's copy is ignored.
  cpu = if stdenv.hostPlatform.isAarch64 then "arm64" else "x64";

  # Dependencies for every platform at once, so one hash fits every system. Update the hash
  # when bun.lock changes: build, and copy the hash Nix reports.
  nodeModules = stdenvNoCC.mkDerivation {
    pname = "whistle-node-modules";
    inherit (pkg) version;
    src = lib.fileset.toSource {
      inherit root;
      fileset = lib.fileset.unions [ (root + "/package.json") (root + "/bun.lock") ];
    };
    nativeBuildInputs = [ bun ];
    dontConfigure = true;
    buildPhase = ''
      runHook preBuild
      export HOME=$TMPDIR
      bun install --frozen-lockfile --ignore-scripts --no-progress --os='*' --cpu='*'
      runHook postBuild
    '';
    installPhase = ''
      runHook preInstall
      cp -r node_modules $out
      runHook postInstall
    '';
    dontFixup = true;
    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    outputHash = "sha256-/mdEyPL81ngAK5zjRjQWrXzWPoSmt0vJWEPA4IhmWAk=";
  };
in
stdenv.mkDerivation {
  pname = "whistle";
  inherit (pkg) version;

  src = lib.fileset.toSource {
    inherit root;
    fileset = lib.fileset.unions [
      (root + "/package.json")
      (root + "/tsconfig.json")
      (root + "/vite.config.ts")
      (root + "/LICENSE")
      (root + "/README.md")
      (root + "/scripts/package.ts")
      (root + "/src")
      (root + "/shared")
      (root + "/web")
    ];
  };

  nativeBuildInputs = [ bun autoPatchelfHook ];
  buildInputs = [ stdenv.cc.cc.lib ];

  configurePhase = ''
    runHook preConfigure
    export HOME=$TMPDIR
    cp -r ${nodeModules} node_modules
    chmod -R u+w node_modules
    autoPatchelf node_modules/@rolldown/binding-linux-${cpu}-gnu node_modules/lightningcss-linux-${cpu}-gnu
    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild
    bun --bun node_modules/vite/bin/vite.js build
    WHISTLE_REVISION=${lib.escapeShellArg revision} bun scripts/package.ts
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm755 dist/whistle $out/bin/whistle
    install -Dm644 LICENSE $out/share/licenses/whistle/LICENSE
    install -Dm644 README.md $out/share/doc/whistle/README.md
    runHook postInstall
  '';

  # The executable is Bun with the app appended; stripping or patching it would break it.
  dontStrip = true;
  dontPatchELF = true;
  dontAutoPatchelf = true;

  doInstallCheck = true;
  installCheckPhase = ''
    $out/bin/whistle --version | grep -F "Whistle ${pkg.version} "
  '';

  meta = {
    description = "Phone remote for the coding agents you run in Herdr";
    homepage = "https://github.com/NoamCohen48/whistle";
    license = lib.licenses.mit;
    mainProgram = "whistle";
    platforms = [ "x86_64-linux" "aarch64-linux" ];
  };
}
