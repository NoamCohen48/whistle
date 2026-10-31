{
  description = "Whistle: a phone remote for the coding agents you run in Herdr";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forEachSystem (pkgs: rec {
        whistle = pkgs.callPackage ./packaging/nix/package.nix {
          revision = self.shortRev or self.dirtyShortRev or "unknown";
        };
        default = whistle;
      });

      apps = forEachSystem (pkgs: {
        default = {
          type = "app";
          program = "${self.packages.${pkgs.stdenv.hostPlatform.system}.whistle}/bin/whistle";
        };
      });

      overlays.default = final: prev: {
        whistle = final.callPackage ./packaging/nix/package.nix {
          revision = self.shortRev or self.dirtyShortRev or "unknown";
        };
      };
    };
}
