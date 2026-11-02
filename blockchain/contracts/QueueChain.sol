// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract QueueChain is AccessControl {
    bytes32 public constant QUEUE_OPERATOR_ROLE = keccak256("QUEUE_OPERATOR_ROLE");

    enum BookingStatus {
        WAITING,
        CALLED,
        VERIFIED,
        COMPLETED,
        SKIPPED
    }

    struct Booking {
        uint64 queueDay;
        uint32 dailyTokenNumber;
        uint8 source;
        BookingStatus status;
        uint64 createdAt;
    }

    uint256 public nextBookingId = 1;
    uint256 public activeBookingId;
    mapping(uint256 => Booking) private bookings;
    mapping(uint64 => uint32) public dailyTokenCount;
    mapping(uint64 => uint32) public nextTokenCursor;
    mapping(uint64 => mapping(uint32 => uint256)) private bookingAtToken;
    mapping(bytes32 => uint256) public bookingForRequest;
    mapping(uint256 => bytes32) public skipReasonCommitment;

    event BookingCreated(
        uint256 indexed bookingId,
        uint64 indexed queueDay,
        uint32 dailyTokenNumber,
        uint8 source,
        bytes32 indexed requestId,
        uint64 createdAt
    );
    event TokenCalled(uint256 indexed bookingId, uint32 dailyTokenNumber, address indexed operator, uint64 createdAt);
    event TokenVerified(uint256 indexed bookingId, uint32 dailyTokenNumber, address indexed operator, uint64 createdAt);
    event TokenSkipped(
        uint256 indexed bookingId,
        uint32 dailyTokenNumber,
        bytes32 reasonCommitment,
        address indexed operator,
        uint64 createdAt
    );
    event TokenCompleted(uint256 indexed bookingId, uint32 dailyTokenNumber, address indexed operator, uint64 createdAt);

    error InvalidRequestId();
    error DuplicateRequest(bytes32 requestId);
    error InvalidSource(uint8 source);
    error ActiveTokenExists();
    error NoWaitingToken();
    error NoActiveToken();
    error InvalidStatus(BookingStatus expected, BookingStatus actual);
    error MissingSkipReason();
    error UnknownBooking(uint256 bookingId);

    constructor(address administrator) {
        require(administrator != address(0), "invalid administrator");
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
        _grantRole(QUEUE_OPERATOR_ROLE, administrator);
    }

    function createBooking(bytes32 requestId, uint8 source)
        external
        onlyRole(QUEUE_OPERATOR_ROLE)
        returns (uint256 bookingId, uint32 dailyTokenNumber)
    {
        if (requestId == bytes32(0)) revert InvalidRequestId();
        if (bookingForRequest[requestId] != 0) revert DuplicateRequest(requestId);
        if (source > 1) revert InvalidSource(source);

        uint64 queueDay = uint64(block.timestamp / 1 days);
        dailyTokenNumber = ++dailyTokenCount[queueDay];
        bookingId = nextBookingId++;
        bookings[bookingId] = Booking({
            queueDay: queueDay,
            dailyTokenNumber: dailyTokenNumber,
            source: source,
            status: BookingStatus.WAITING,
            createdAt: uint64(block.timestamp)
        });
        bookingAtToken[queueDay][dailyTokenNumber] = bookingId;
        bookingForRequest[requestId] = bookingId;

        emit BookingCreated(bookingId, queueDay, dailyTokenNumber, source, requestId, uint64(block.timestamp));
    }

    function callNext() external onlyRole(QUEUE_OPERATOR_ROLE) returns (uint256 bookingId) {
        if (activeBookingId != 0) revert ActiveTokenExists();
        uint64 queueDay = uint64(block.timestamp / 1 days);
        uint32 cursor = nextTokenCursor[queueDay] + 1;
        uint32 lastToken = dailyTokenCount[queueDay];

        while (cursor <= lastToken) {
            uint256 candidateId = bookingAtToken[queueDay][cursor];
            if (bookings[candidateId].status == BookingStatus.WAITING) {
                nextTokenCursor[queueDay] = cursor;
                bookings[candidateId].status = BookingStatus.CALLED;
                activeBookingId = candidateId;
                emit TokenCalled(candidateId, cursor, msg.sender, uint64(block.timestamp));
                return candidateId;
            }
            cursor++;
        }
        revert NoWaitingToken();
    }

    function markVerified(uint256 bookingId) external onlyRole(QUEUE_OPERATOR_ROLE) {
        if (activeBookingId == 0 || activeBookingId != bookingId) revert NoActiveToken();
        Booking storage booking = bookings[bookingId];
        if (booking.status != BookingStatus.CALLED) revert InvalidStatus(BookingStatus.CALLED, booking.status);
        booking.status = BookingStatus.VERIFIED;
        emit TokenVerified(bookingId, booking.dailyTokenNumber, msg.sender, uint64(block.timestamp));
    }

    function skipCurrent(bytes32 reasonCommitment) external onlyRole(QUEUE_OPERATOR_ROLE) {
        if (activeBookingId == 0) revert NoActiveToken();
        if (reasonCommitment == bytes32(0)) revert MissingSkipReason();
        uint256 bookingId = activeBookingId;
        Booking storage booking = bookings[bookingId];
        if (booking.status != BookingStatus.CALLED) revert InvalidStatus(BookingStatus.CALLED, booking.status);
        booking.status = BookingStatus.SKIPPED;
        skipReasonCommitment[bookingId] = reasonCommitment;
        activeBookingId = 0;
        emit TokenSkipped(bookingId, booking.dailyTokenNumber, reasonCommitment, msg.sender, uint64(block.timestamp));
    }

    function completeCurrent() external onlyRole(QUEUE_OPERATOR_ROLE) {
        if (activeBookingId == 0) revert NoActiveToken();
        uint256 bookingId = activeBookingId;
        Booking storage booking = bookings[bookingId];
        if (booking.status != BookingStatus.VERIFIED) revert InvalidStatus(BookingStatus.VERIFIED, booking.status);
        booking.status = BookingStatus.COMPLETED;
        activeBookingId = 0;
        emit TokenCompleted(bookingId, booking.dailyTokenNumber, msg.sender, uint64(block.timestamp));
    }

    function getBooking(uint256 bookingId)
        external
        view
        returns (uint64 queueDay, uint32 dailyTokenNumber, uint8 source, BookingStatus status, uint64 createdAt)
    {
        Booking memory booking = bookings[bookingId];
        if (booking.createdAt == 0) revert UnknownBooking(bookingId);
        return (booking.queueDay, booking.dailyTokenNumber, booking.source, booking.status, booking.createdAt);
    }

    function getQueueStatus()
        external
        view
        returns (uint64 queueDay, uint256 currentBookingId, uint32 currentToken, uint32 waitingCount)
    {
        queueDay = uint64(block.timestamp / 1 days);
        currentBookingId = activeBookingId;
        currentToken = currentBookingId == 0 ? 0 : bookings[currentBookingId].dailyTokenNumber;
        uint32 lastToken = dailyTokenCount[queueDay];
        for (uint32 token = nextTokenCursor[queueDay] + 1; token <= lastToken; token++) {
            if (bookings[bookingAtToken[queueDay][token]].status == BookingStatus.WAITING) waitingCount++;
        }
    }
}
