// Acceso al nodo IPFS local (Kubo en Docker) mediante su API HTTP.
// Equivale a lo que hace kubo-rpc-client en el ejercicio 1 (client.add + client.files.cp),
// pero sin dependencias extra.

export const IPFS_API = "http://127.0.0.1:5001/api/v0";
export const IPFS_GATEWAY = "http://127.0.0.1:8080/ipfs/";
export const IPFS_GATEWAY_PUBLICO = "https://ipfs.io/ipfs/";

async function post(ruta) {
  const r = await fetch(`${IPFS_API}/${ruta}`, { method: "POST" });
  if (!r.ok) throw new Error(`IPFS ${ruta.split("?")[0]}: ${await r.text()}`);
  return r;
}

async function add(file, soloHash) {
  const fd = new FormData();
  fd.append("file", file, file.name);
  const params = `cid-version=1&pin=${soloHash ? "false" : "true"}${soloHash ? "&only-hash=true" : ""}`;
  let r;
  try {
    r = await fetch(`${IPFS_API}/add?${params}`, { method: "POST", body: fd });
  } catch (e) {
    throw new Error(
      "No se puede conectar con IPFS en 127.0.0.1:5001. ¿Está el contenedor ipfs_host arrancado y con CORS configurado?"
    );
  }
  if (!r.ok) throw new Error("IPFS add: " + (await r.text()));
  // La respuesta es NDJSON; la última línea corresponde al fichero añadido
  const lineas = (await r.text()).trim().split("\n");
  return JSON.parse(lineas[lineas.length - 1]).Hash;
}

/** Sube el fichero a IPFS, lo fija (pin) y lo copia a /torneo/<carpeta>/ en el MFS
 *  para que aparezca en la pestaña "Files" del dashboard (WebUI). Devuelve el CID. */
export async function subirAIpfs(file, carpeta) {
  const cid = await add(file, false);
  const dir = `/torneo/${carpeta}`;
  try {
    await post(`files/mkdir?arg=${encodeURIComponent(dir)}&parents=true`);
    await post(
      `files/cp?arg=${encodeURIComponent("/ipfs/" + cid)}&arg=${encodeURIComponent(`${dir}/${file.name}`)}`
    );
  } catch (e) {
    // Si ya existía un fichero con ese nombre en el MFS no es un problema: el CID ya está fijado
    console.log("MFS:", e.message);
  }
  return cid;
}

/** Calcula el CID que tendría el fichero sin almacenarlo (only-hash).
 *  Sirve para verificar si un documento coincide con uno registrado en la blockchain. */
export async function calcularCid(file) {
  return add(file, true);
}
