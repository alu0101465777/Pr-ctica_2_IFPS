// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title TorneoIPFS
 * @notice Financiación colectiva de un torneo de fútbol (Práctica 1, ejercicio 5)
 *         ampliada con documentación almacenada en IPFS.
 *
 *  - Los ficheros (reglamento, presupuesto, inscripciones, facturas, actas, fotos)
 *    se guardan en IPFS. En la blockchain solo se registra su CID, el tipo, el autor
 *    y la fecha, de modo que cualquiera puede comprobar que no se han modificado.
 *  - No se aceptan aportaciones hasta que el organizador publica el reglamento y el
 *    presupuesto. Desde la primera aportación esos dos documentos quedan bloqueados.
 *  - Si se alcanza la meta, el organizador retira los fondos y después justifica el
 *    gasto subiendo facturas y el acta del torneo. Si no se alcanza, cada participante
 *    recupera su aportación (igual que en la Práctica 1).
 */
contract TorneoIPFS {
    enum Tipo { Reglamento, Presupuesto, Inscripcion, Factura, Acta, Foto }
    enum Estado { Abierta, Exitosa, Fallida }

    struct Documento {
        uint256 id;
        Tipo tipo;
        string cid;
        string nombre;
        address autor;
        uint256 fecha;
    }

    // ---- Datos de la campaña (Práctica 1) ----
    address public immutable organizador;
    uint256 public immutable objetivo;
    uint256 public immutable fechaLimite;
    string public nombreTorneo;

    uint256 public totalRecaudado;
    bool public fondosRetirados;
    mapping(address => uint256) public aportaciones;

    // ---- Documentación en IPFS (Práctica 2) ----
    Documento[] private documentos;
    mapping(address => uint256[]) private documentosPorAutor;
    mapping(Tipo => uint256) private ultimoPorTipo; // id + 1 (0 = ninguno)

    // ---- Eventos ----
    event Aportacion(address indexed participante, uint256 cantidad);
    event Retirada(address indexed organizador, uint256 cantidad);
    event Devolucion(address indexed participante, uint256 cantidad);
    event DocumentoSubido(uint256 indexed id, Tipo tipo, address indexed autor, string cid);

    // ---- Errores ----
    error ParametrosInvalidos();
    error SoloOrganizador();
    error CampanaCerrada();
    error CampanaAbierta();
    error ImporteNulo();
    error FaltaDocumentacion();
    error DocumentacionBloqueada();
    error MetaNoAlcanzada();
    error MetaAlcanzada();
    error YaRetirado();
    error FondosNoRetirados();
    error SinAportacion();
    error NoAutorizado();
    error CidVacio();
    error DocumentoInexistente();
    error TransferenciaFallida();

    modifier soloOrganizador() {
        if (msg.sender != organizador) revert SoloOrganizador();
        _;
    }

    /**
     * @param _nombre          Nombre del torneo.
     * @param _objetivoWei     Cantidad mínima a recaudar (en wei).
     * @param _duracionMinutos Duración de la campaña en minutos.
     */
    constructor(string memory _nombre, uint256 _objetivoWei, uint256 _duracionMinutos) {
        if (_objetivoWei == 0 || _duracionMinutos == 0) revert ParametrosInvalidos();
        organizador = msg.sender;
        objetivo = _objetivoWei;
        fechaLimite = block.timestamp + _duracionMinutos * 1 minutes;
        nombreTorneo = _nombre;
    }

    // =====================================================================
    //  Financiación (lógica de la Práctica 1)
    // =====================================================================

    function aportar() external payable {
        if (block.timestamp >= fechaLimite) revert CampanaCerrada();
        if (msg.value == 0) revert ImporteNulo();
        if (!documentacionPublicada()) revert FaltaDocumentacion();

        aportaciones[msg.sender] += msg.value;
        totalRecaudado += msg.value;
        emit Aportacion(msg.sender, msg.value);
    }

    function retirarFondos() external soloOrganizador {
        if (block.timestamp < fechaLimite) revert CampanaAbierta();
        if (totalRecaudado < objetivo) revert MetaNoAlcanzada();
        if (fondosRetirados) revert YaRetirado();

        fondosRetirados = true;
        uint256 cantidad = address(this).balance;
        (bool ok, ) = payable(organizador).call{value: cantidad}("");
        if (!ok) revert TransferenciaFallida();
        emit Retirada(organizador, cantidad);
    }

    function solicitarDevolucion() external {
        if (block.timestamp < fechaLimite) revert CampanaAbierta();
        if (totalRecaudado >= objetivo) revert MetaAlcanzada();
        uint256 cantidad = aportaciones[msg.sender];
        if (cantidad == 0) revert SinAportacion();

        aportaciones[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: cantidad}("");
        if (!ok) revert TransferenciaFallida();
        emit Devolucion(msg.sender, cantidad);
    }

    // =====================================================================
    //  Documentación en IPFS
    // =====================================================================

    /**
     * @notice Registra el CID de un fichero ya subido a IPFS.
     *  Reglamento / Presupuesto: solo organizador y antes de la primera aportación.
     *  Inscripcion:              participante con aportación y campaña abierta.
     *  Factura / Acta:           solo organizador y después de retirar los fondos.
     *  Foto:                     organizador o participante con aportación.
     */
    function subirDocumento(Tipo tipo, string calldata cid, string calldata nombre)
        external
        returns (uint256 id)
    {
        if (bytes(cid).length == 0) revert CidVacio();
        bool esOrganizador = msg.sender == organizador;

        if (tipo == Tipo.Reglamento || tipo == Tipo.Presupuesto) {
            if (!esOrganizador) revert SoloOrganizador();
            if (totalRecaudado > 0) revert DocumentacionBloqueada();
        } else if (tipo == Tipo.Inscripcion) {
            if (aportaciones[msg.sender] == 0) revert NoAutorizado();
            if (block.timestamp >= fechaLimite) revert CampanaCerrada();
        } else if (tipo == Tipo.Factura || tipo == Tipo.Acta) {
            if (!esOrganizador) revert SoloOrganizador();
            if (!fondosRetirados) revert FondosNoRetirados();
        } else {
            if (!esOrganizador && aportaciones[msg.sender] == 0) revert NoAutorizado();
        }

        id = documentos.length;
        documentos.push(Documento(id, tipo, cid, nombre, msg.sender, block.timestamp));
        documentosPorAutor[msg.sender].push(id);
        ultimoPorTipo[tipo] = id + 1;
        emit DocumentoSubido(id, tipo, msg.sender, cid);
    }

    // =====================================================================
    //  Consultas
    // =====================================================================

    function estado() public view returns (Estado) {
        if (block.timestamp < fechaLimite) return Estado.Abierta;
        return totalRecaudado >= objetivo ? Estado.Exitosa : Estado.Fallida;
    }

    function documentacionPublicada() public view returns (bool) {
        return ultimoPorTipo[Tipo.Reglamento] != 0 && ultimoPorTipo[Tipo.Presupuesto] != 0;
    }

    function numDocumentos() external view returns (uint256) {
        return documentos.length;
    }

    function getDocumento(uint256 id) external view returns (Documento memory) {
        if (id >= documentos.length) revert DocumentoInexistente();
        return documentos[id];
    }

    function getDocumentos() external view returns (Documento[] memory) {
        return documentos;
    }

    function getDocumentosDe(address autor) external view returns (uint256[] memory) {
        return documentosPorAutor[autor];
    }

    function ultimoDocumento(Tipo tipo) external view returns (Documento memory) {
        uint256 idMas1 = ultimoPorTipo[tipo];
        if (idMas1 == 0) revert DocumentoInexistente();
        return documentos[idMas1 - 1];
    }

    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
