// Ejercicio 2 - Práctica 2 (BC): TorneoIPFS
// Financiación de un torneo de fútbol (Práctica 1) + documentación en IPFS.
// Parte del código del ejercicio 1: mismo esquema contracts/, ethers 5.7 y nodo IPFS local.
import React, { useCallback, useEffect, useState } from "react";
import "./App.css";
import { ethers } from "ethers";

import logo from "./ethereumLogo.png";
import { addresses, abis } from "./contracts";
import { subirAIpfs, calcularCid, IPFS_GATEWAY, IPFS_GATEWAY_PUBLICO } from "./ipfs";

const SEPOLIA_CHAIN_ID = "0xaa36a7"; // 11155111
const ETHERSCAN = "https://sepolia.etherscan.io";

const TIPOS = ["Reglamento", "Presupuesto", "Inscripción", "Factura", "Acta", "Foto"];
const CARPETAS = ["reglamento", "presupuesto", "inscripciones", "facturas", "actas", "fotos"];
const ESTADOS = ["Abierta", "Exitosa (meta alcanzada)", "Fallida (meta no alcanzada)"];

const MENSAJES_ERROR = {
  ParametrosInvalidos: "Parámetros de despliegue inválidos.",
  SoloOrganizador: "Solo el organizador puede hacer esta operación.",
  CampanaCerrada: "La campaña ya ha terminado.",
  CampanaAbierta: "La campaña sigue abierta: espera a la fecha límite.",
  ImporteNulo: "El importe debe ser mayor que cero.",
  FaltaDocumentacion: "El organizador aún no ha publicado el reglamento y el presupuesto en IPFS.",
  DocumentacionBloqueada: "El reglamento y el presupuesto no pueden cambiarse después de recibir aportaciones.",
  MetaNoAlcanzada: "No se ha alcanzado la meta: no se pueden retirar los fondos.",
  MetaAlcanzada: "La meta se alcanzó: no hay devoluciones.",
  YaRetirado: "Los fondos ya se retiraron.",
  FondosNoRetirados: "Las facturas y el acta se suben después de retirar los fondos.",
  SinAportacion: "Esta cuenta no tiene aportaciones pendientes.",
  NoAutorizado: "Para subir este documento hay que haber aportado a la campaña.",
  CidVacio: "CID vacío.",
  DocumentoInexistente: "El documento no existe.",
  TransferenciaFallida: "La transferencia de ETH ha fallado.",
};

const provider = window.ethereum ? new ethers.providers.Web3Provider(window.ethereum) : null;
const lectura = provider ? new ethers.Contract(addresses.torneo, abis.torneo, provider) : null;

// Busca recursivamente los datos de revert dentro del error que devuelven MetaMask/ethers
function buscarDatosRevert(e, prof = 0) {
  if (!e || prof > 6) return null;
  if (typeof e === "string") {
    if (/^0x[0-9a-fA-F]{8}/.test(e)) return e;
    const m = e.match(/data="(0x[0-9a-fA-F]{8,})"/);
    return m ? m[1] : null;
  }
  if (typeof e === "object") {
    for (const k of ["data", "error", "originalError", "info", "message"]) {
      const v = buscarDatosRevert(e[k], prof + 1);
      if (v) return v;
    }
    if (typeof e.body === "string") {
      try {
        return buscarDatosRevert(JSON.parse(e.body), prof + 1);
      } catch (_) {}
    }
  }
  return null;
}

function mensajeError(err) {
  if (err?.code === 4001 || err?.code === "ACTION_REJECTED") return "Operación rechazada en MetaMask.";
  const datos = buscarDatosRevert(err);
  if (datos && lectura) {
    try {
      const e = lectura.interface.parseError(datos);
      return MENSAJES_ERROR[e.name] || e.name;
    } catch (_) {}
  }
  return err?.reason || err?.data?.message || err?.message || String(err);
}

const corta = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const fecha = (s) => new Date(Number(s) * 1000).toLocaleString("es-ES");

function App() {
  const [cuenta, setCuenta] = useState("");
  const [redOk, setRedOk] = useState(true);
  const [info, setInfo] = useState(null);
  const [docs, setDocs] = useState([]);
  const [ahora, setAhora] = useState(Math.floor(Date.now() / 1000));

  const [importe, setImporte] = useState("0.001");
  const [tipo, setTipo] = useState(0);
  const [fichero, setFichero] = useState(null);
  const [ficheroVerificar, setFicheroVerificar] = useState(null);
  const [verificacion, setVerificacion] = useState(null);

  const [ocupado, setOcupado] = useState(false);
  const [estadoMsg, setEstadoMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [ultimaTx, setUltimaTx] = useState("");

  // ---------------- Lectura del estado del contrato ----------------
  const cargar = useCallback(async () => {
    if (!lectura) return;
    try {
      const net = await provider.getNetwork();
      const ok = net.chainId === 11155111;
      setRedOk(ok);
      if (!ok) return;
      const [nombre, org, obj, limite, recaudado, retirados, est, docPub, saldo, lista] = await Promise.all([
        lectura.nombreTorneo(),
        lectura.organizador(),
        lectura.objetivo(),
        lectura.fechaLimite(),
        lectura.totalRecaudado(),
        lectura.fondosRetirados(),
        lectura.estado(),
        lectura.documentacionPublicada(),
        lectura.getContractBalance(),
        lectura.getDocumentos(),
      ]);
      const miAportacion = cuenta ? await lectura.aportaciones(cuenta) : ethers.constants.Zero;
      setInfo({ nombre, org, obj, limite: limite.toNumber(), recaudado, retirados, est, docPub, saldo, miAportacion });
      setDocs(
        lista.map((d) => ({
          id: d.id.toNumber(),
          tipo: d.tipo,
          cid: d.cid,
          nombre: d.nombre,
          autor: d.autor,
          fecha: d.fecha.toNumber(),
        }))
      );
    } catch (err) {
      console.log(err);
      setErrorMsg(
        "No se pudo leer el contrato. Revisa la dirección en src/contracts/src/addresses.js y que MetaMask esté en Sepolia. (" +
          mensajeError(err) +
          ")"
      );
    }
  }, [cuenta]);

  // ---------------- Conexión con MetaMask ----------------
  async function conectar() {
    try {
      const cuentas = await window.ethereum.request({ method: "eth_requestAccounts" });
      setCuenta(ethers.utils.getAddress(cuentas[0]));
    } catch (err) {
      setErrorMsg(mensajeError(err));
    }
  }

  async function cambiarASepolia() {
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
    } catch (err) {
      setErrorMsg(mensajeError(err));
    }
  }

  useEffect(() => {
    if (!window.ethereum) return;
    conectar();
    const onCuentas = (c) => setCuenta(c[0] ? ethers.utils.getAddress(c[0]) : "");
    const onRed = () => window.location.reload();
    window.ethereum.on("accountsChanged", onCuentas);
    window.ethereum.on("chainChanged", onRed);
    return () => {
      window.ethereum.removeListener("accountsChanged", onCuentas);
      window.ethereum.removeListener("chainChanged", onRed);
    };
  }, []);

  useEffect(() => {
    cargar();
    const t = setInterval(cargar, 15000);
    return () => clearInterval(t);
  }, [cargar]);

  useEffect(() => {
    const t = setInterval(() => setAhora(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // ---------------- Envío de transacciones ----------------
  async function enviar(descripcion, fn, args = [], overrides = {}) {
    const firmado = lectura.connect(provider.getSigner());
    // Simulación previa: si va a fallar, mostramos el motivo sin gastar gas
    await firmado.callStatic[fn](...args, overrides);
    setEstadoMsg(`${descripcion}: confirma la transacción en MetaMask…`);
    const tx = await firmado[fn](...args, overrides);
    setUltimaTx(tx.hash);
    setEstadoMsg(`${descripcion}: esperando confirmación en Sepolia…`);
    await tx.wait();
    setEstadoMsg(`${descripcion}: transacción confirmada.`);
    await cargar();
    return tx.hash;
  }

  async function ejecutar(accion) {
    setOcupado(true);
    setErrorMsg("");
    try {
      await accion();
    } catch (err) {
      console.log(err);
      setErrorMsg(mensajeError(err));
      setEstadoMsg("");
    } finally {
      setOcupado(false);
    }
  }

  const aportar = () =>
    ejecutar(() => enviar("Aportación", "aportar", [], { value: ethers.utils.parseEther(importe || "0") }));
  const retirar = () => ejecutar(() => enviar("Retirada de fondos", "retirarFondos"));
  const devolucion = () => ejecutar(() => enviar("Devolución", "solicitarDevolucion"));

  const subirDocumento = (e) => {
    e.preventDefault();
    ejecutar(async () => {
      if (!fichero) throw new Error("Selecciona un fichero.");
      setEstadoMsg("Subiendo el fichero a IPFS…");
      const cid = await subirAIpfs(fichero, CARPETAS[tipo]);
      setEstadoMsg(`Fichero en IPFS con CID ${cid}. Registrando en la blockchain…`);
      await enviar(`Registro de ${TIPOS[tipo]}`, "subirDocumento", [tipo, cid, fichero.name]);
      setFichero(null);
      e.target.reset();
    });
  };

  const verificar = (e) => {
    e.preventDefault();
    ejecutar(async () => {
      if (!ficheroVerificar) throw new Error("Selecciona un fichero para verificar.");
      const cid = await calcularCid(ficheroVerificar);
      const encontrado = docs.find((d) => d.cid === cid);
      setVerificacion({ cid, encontrado, nombre: ficheroVerificar.name });
    });
  };

  // ---------------- Interfaz ----------------
  if (!window.ethereum) {
    return (
      <div className="App">
        <p className="error">Instala MetaMask para usar esta DApp.</p>
      </div>
    );
  }

  const esOrganizador = info && cuenta && info.org.toLowerCase() === cuenta.toLowerCase();
  const restante = info ? Math.max(0, info.limite - ahora) : 0;
  const rol = esOrganizador ? "Organizador" : info && info.miAportacion.gt(0) ? "Participante" : "Visitante";
  const progreso = info && info.obj.gt(0) ? Math.min(100, info.recaudado.mul(100).div(info.obj).toNumber()) : 0;

  return (
    <div className="App">
      <header className="cabecera">
        <img src={logo} className="logo" alt="logo" />
        <div>
          <h1>TorneoIPFS</h1>
          <p>Financiación transparente de un torneo de fútbol con documentación en IPFS</p>
        </div>
        <div className="cuenta">
          {cuenta ? (
            <>
              <span>{corta(cuenta)}</span>
              <span className={`rol rol-${rol.toLowerCase()}`}>{rol}</span>
            </>
          ) : (
            <button onClick={conectar}>Conectar MetaMask</button>
          )}
        </div>
      </header>

      {!redOk && (
        <div className="aviso">
          MetaMask no está en Sepolia. <button onClick={cambiarASepolia}>Cambiar a Sepolia</button>
        </div>
      )}
      {errorMsg && <div className="error">{errorMsg}</div>}
      {estadoMsg && (
        <div className="estado">
          {estadoMsg}{" "}
          {ultimaTx && (
            <a href={`${ETHERSCAN}/tx/${ultimaTx}`} target="_blank" rel="noreferrer">
              Ver en Etherscan
            </a>
          )}
        </div>
      )}

      {info && (
        <main className="rejilla">
          <section className="tarjeta">
            <h2>{info.nombre}</h2>
            <dl>
              <dt>Contrato</dt>
              <dd>
                <a href={`${ETHERSCAN}/address/${addresses.torneo}`} target="_blank" rel="noreferrer">
                  {corta(addresses.torneo)}
                </a>
              </dd>
              <dt>Organizador</dt>
              <dd>{corta(info.org)}</dd>
              <dt>Estado</dt>
              <dd>{ESTADOS[info.est]}</dd>
              <dt>Fecha límite</dt>
              <dd>
                {fecha(info.limite)} {restante > 0 && `(quedan ${Math.floor(restante / 60)} min ${restante % 60} s)`}
              </dd>
              <dt>Recaudado</dt>
              <dd>
                {ethers.utils.formatEther(info.recaudado)} / {ethers.utils.formatEther(info.obj)} ETH
              </dd>
              <dt>Saldo del contrato</dt>
              <dd>{ethers.utils.formatEther(info.saldo)} ETH</dd>
              <dt>Fondos retirados</dt>
              <dd>{info.retirados ? "Sí" : "No"}</dd>
              <dt>Reglamento y presupuesto</dt>
              <dd>{info.docPub ? "Publicados en IPFS" : "Pendientes"}</dd>
              <dt>Mi aportación</dt>
              <dd>{ethers.utils.formatEther(info.miAportacion)} ETH</dd>
            </dl>
            <div className="barra">
              <div style={{ width: `${progreso}%` }} />
            </div>
          </section>

          <section className="tarjeta">
            <h2>Financiación</h2>
            <label>
              Importe (ETH)
              <input type="number" min="0" step="0.0001" value={importe} onChange={(e) => setImporte(e.target.value)} />
            </label>
            <button disabled={ocupado} onClick={aportar}>
              Aportar
            </button>
            <hr />
            <button disabled={ocupado} onClick={retirar}>
              Retirar fondos (organizador)
            </button>
            <button disabled={ocupado} onClick={devolucion}>
              Solicitar devolución
            </button>
            <p className="nota">
              Las aportaciones se aceptan cuando el reglamento y el presupuesto están en IPFS. Al terminar el plazo, si se
              alcanza la meta cobra el organizador; si no, cada participante recupera lo aportado.
            </p>
          </section>

          <section className="tarjeta">
            <h2>Subir documento a IPFS</h2>
            <form onSubmit={subirDocumento}>
              <label>
                Tipo
                <select value={tipo} onChange={(e) => setTipo(Number(e.target.value))}>
                  {TIPOS.map((t, i) => (
                    <option key={t} value={i}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <input type="file" onChange={(e) => setFichero(e.target.files[0] || null)} />
              <button type="submit" disabled={ocupado}>
                Subir y registrar
              </button>
            </form>
            <p className="nota">
              Reglamento y presupuesto: organizador, antes de la primera aportación. Inscripción: participantes con
              aportación. Factura y acta: organizador, tras retirar los fondos. Foto: organizador o participantes.
            </p>
          </section>

          <section className="tarjeta">
            <h2>Verificar un documento</h2>
            <form onSubmit={verificar}>
              <input type="file" onChange={(e) => setFicheroVerificar(e.target.files[0] || null)} />
              <button type="submit" disabled={ocupado}>
                Verificar
              </button>
            </form>
            {verificacion && (
              <div className={verificacion.encontrado ? "ok" : "error"}>
                <p>
                  CID calculado: <code>{verificacion.cid}</code>
                </p>
                {verificacion.encontrado ? (
                  <p>
                    ✔ «{verificacion.nombre}» coincide con el documento #{verificacion.encontrado.id} (
                    {TIPOS[verificacion.encontrado.tipo]}) registrado el {fecha(verificacion.encontrado.fecha)}.
                  </p>
                ) : (
                  <p>✘ Este fichero no coincide con ningún documento registrado (o ha sido modificado).</p>
                )}
              </div>
            )}
          </section>

          <section className="tarjeta ancha">
            <h2>Documentos registrados ({docs.length})</h2>
            {docs.length === 0 ? (
              <p>Todavía no hay documentos.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Tipo</th>
                    <th>Nombre</th>
                    <th>Autor</th>
                    <th>Fecha</th>
                    <th>CID</th>
                  </tr>
                </thead>
                <tbody>
                  {docs
                    .slice()
                    .reverse()
                    .map((d) => (
                      <tr key={d.id}>
                        <td>{d.id}</td>
                        <td>{TIPOS[d.tipo]}</td>
                        <td>{d.nombre}</td>
                        <td>{corta(d.autor)}</td>
                        <td>{fecha(d.fecha)}</td>
                        <td>
                          <a href={IPFS_GATEWAY + d.cid} target="_blank" rel="noreferrer">
                            {corta(d.cid)}
                          </a>{" "}
                          <a className="publico" href={IPFS_GATEWAY_PUBLICO + d.cid} target="_blank" rel="noreferrer">
                            (ipfs.io)
                          </a>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
