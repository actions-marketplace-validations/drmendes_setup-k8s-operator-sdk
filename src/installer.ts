import * as tc from "@actions/tool-cache";
import * as semver from "semver";
import * as httpm from "@actions/http-client";
import * as sys from "./system";
import { debug } from "@actions/core";

export async function installSdk(
  versionSpec: string
): Promise<string | undefined> {
  let toolPath: string | undefined;
  try {
    let match = await findMatch(versionSpec);
    if (match) {
      let astBinary, astCheck: ISdkAsset | undefined;
      for (let i = 0; i < match.assets.length; i++) {
        let asset = match.assets[i];
        if (asset.name.endsWith(".asc")) astCheck = asset;
        else astBinary = asset;
      }
      if (astBinary && astCheck) {
        console.log(`Downloading from ${astBinary.browser_download_url}`);
        let binaryPath = await tc.downloadTool(astBinary.browser_download_url);
        // let checkPath = await tc.downloadTool(astCheck.browser_download_url)
        let destPath = "operator-sdk";
        toolPath = await tc.cacheFile(
          binaryPath,
          destPath,
          "operator-sdk",
          makeSemver(match.tag_name)
        );
      }
    }
  } catch (error) {
    throw new Error(`Failed to download version ${versionSpec}: ${error}`);
  }
  return toolPath;
}

interface ISdkAsset {
  url: string;
  name: string;
  browser_download_url: string;
}

interface ISdkRelease {
  url: string;
  tag_name: string;
  assets: ISdkAsset[];
}

async function findMatch(
  versionSpec: string
): Promise<ISdkRelease | undefined> {
  let result: ISdkRelease | undefined;
  let arch = sys.getArch();
  let platform = sys.getPlatform();
  let assetFilter = `${arch}-${platform}`;
  debug(`assetFilter used - "${assetFilter}"`);
  let candidates = await getVersions();
  if (!candidates) {
    throw new Error(`operator-sdk releases url did not return results`);
  }
  for (let i = 0; i < candidates.length; i++) {
    let candidate = candidates[i];
    let version = makeSemver(candidate.tag_name);
    debug(`check ${version} satisfies ${versionSpec}`);
    if (semver.satisfies(version, versionSpec)) {
      let assets = candidate.assets.filter((asset) => {
        asset.name.includes(assetFilter);
      });
      if (assets) {
        debug(`matched ${version}`);
        result = <ISdkRelease>Object.assign({}, candidate);
        result.assets = assets;
        break;
      }
    }
  }
  return result;
}

// this returns versions descending so latest is first
async function getVersions(): Promise<ISdkRelease[] | null> {
  const apiUrl =
    "https://api.github.com/repos/operator-framework/operator-sdk/releases";
  let http: httpm.HttpClient = new httpm.HttpClient("setup-operator-sdk");
  return (await http.getJson<ISdkRelease[]>(apiUrl)).result;
}

//
// Convert the go version syntax into semver for semver matching
// 1.13.1 => 1.13.1
// 1.13 => 1.13.0
// v1.0.0 => 1.0.0
// 1.10beta1 => 1.10.0-beta1, 1.10rc1 => 1.10.0-rc1
// 1.8.5beta1 => 1.8.5-beta1, 1.8.5rc1 => 1.8.5-rc1
export function makeSemver(version: string): string {
  version = version.replace("v", "");
  version = version.replace("beta", "-beta").replace("rc", "-rc");
  let parts = version.split("-");

  let verPart: string = parts[0];
  let prereleasePart = parts.length > 1 ? `-${parts[1]}` : "";

  let verParts: string[] = verPart.split(".");
  if (verParts.length == 2) {
    verPart += ".0";
  }

  return `${verPart}${prereleasePart}`;
}